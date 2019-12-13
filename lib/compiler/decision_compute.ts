import { Data, exec } from '../utils'
import { compute_path_test_length } from '../runtime/decision'

import { Node } from './ast'

export const AstDecisionPath = Data((...path: (string[] | AstDecisionBranch)[]): AstDecisionPath => {
	return { type: 'AstDecisionPath' as const, path, test_length: compute_path_test_length(path) }
})
export type AstDecisionPath = Readonly<{ type: 'AstDecisionPath', path: (string[] | AstDecisionBranch)[], test_length: number }>

export const AstDecisionBranch = Data((...paths: AstDecisionPath[]): AstDecisionBranch => {
	const is_optional = paths.length === 1
	const test_length = Math.max(...paths.map(p => p.test_length))
	return { type: 'AstDecisionBranch' as const, is_optional, paths: paths.slice(), test_length }
})
export type AstDecisionBranch = Readonly<{ type: 'AstDecisionBranch', is_optional: boolean, paths: AstDecisionPath[], test_length: number }>
export type AstDecidable = AstDecisionPath | AstDecisionBranch

export class PathBuilder {
	private items = [] as (string[] | AstDecisionBranch)[]

	push_branch(paths: AstDecisionPath[]) {
		this.items.push(AstDecisionBranch(
			...paths.filter(path => path.test_length > 0)
		))
	}

	push(def: string) {
		const last_index = this.items.length - 1
		const last = this.items[last_index]
		if (this.items.length === 0 || !Array.isArray(last)) {
			this.items.push([def])
			return
		}
		last.push(def)
	}

	build(): AstDecidable {
		const last_index = this.items.length - 1
		const last = this.items.maybe_get(-1)
		if (last.is_some() && !Array.isArray(last.value)) {
			if (this.items.length === 1)
				return last.value

			if (last.value.is_optional)
				this.items.splice(last_index, 1)
		}

		return AstDecisionPath(...this.items)
	}
}



export function gather_branches(next: [Node, ScopeStack][]): [Definition, ScopeStack][] {
	let tuple
	const branches = []
	while (tuple = next.shift()) {
		const [node, scope] = tuple
		if (node.needs_decidable)
			branches.push([[node], scope])
		else
			break
	}

	return branches
}


const Continue = Data((...definition_tuple: DefinitionTuple) => {
	return { type: 'Continue' as const, definition_tuple }
})
type Continue = ReturnType<typeof Continue>

function is_continue(item: string | Continue): item is Continue {
	return typeof item !== 'string'
}

type AstIterItem = string | DefinitionTuple[] | Continue
type AstIter = IterWrapper<AstIterItem>

function* iterate_definition(
	// tuples: [Definition, ScopeStack][],
	definition: Definition, scope: ScopeStack,
): Generator<AstIterItem, void, undefined> {
	const tuples_to_visit = Scope.zip_nodes(definition, scope)
	let tuple
	while (tuple = tuples_to_visit.shift()) {
		const [node, scope] = tuple

		type SubIterator =
			| { t: 'star', star: Iterable<AstIterItem> }
			| { t: 'branches', branches: DefinitionTuple[] }

		const [sub, always_optional] = exec((): [SubIterator, boolean] => {
			switch (node.type) {
			case 'Consume':
				return t({ t: 'star', star: node.token_names }, false)
				// yield* node.token_names

			case 'Or':
				return t(Scope.zip_definitions(node.choices, scope), false, false)

			case 'Subrule':
				const rule = get_rule(node.rule_name).unwrap()
				const rule_scope = Scope.for_rule(rule)
				return t(t(rule.definition, rule_scope), true, rule.always_optional)

			case 'MacroCall':
				const macro = get_macro(node.macro_name).unwrap()
				const macro_scope = Scope.for_macro(scope, macro, node)
				return t(t(macro.definition, macro_scope), true, macro.always_optional)

			case 'Var':
				const var_tuple = Scope.for_var(scope, node)
				// TODO this isn't accurate, it has to recurse to really know this
				return t(var_tuple, true, Definition.all_optional(arg_definition[0]))

			case 'LockingVar':
				const locked_token_name = Scope.for_locking_var(scope, node)
				return t([locked_token_name], true, false)

			default: return exhaustive(node)
			}
		})

		switch (node.modifier) {
		case '?':
			yield [tuple, gather_branches(tuples_to_visit)]
			break
		case '+':
			yield Continue(...tuple)
			break
		case '*':
			yield [tuple, gather_branches(tuples_to_visit), Continue(...tuple)]
			break
		default:
			switch (sub.t) {
			case 'star':
				if (always_optional) {
					const branches = gather_branches(tuples_to_visit)
					yield [Consume(undefined, )]
				}
				else yield* sub.star
			case 'branches':
				if (always_optional) {
					const branches = gather_branches(tuples_to_visit)
					yield [...sub, ...branches]
				}
				else yield sub
			}
		}
	}
}

function AstIter(definition_tuple: DefinitionTuple): AstIter {
	return IterWrapper.create(() => iterate_definition(...definition_tuple))
}
function EternalAstIter(definition_tuple: DefinitionTuple): AstIter {
	return IterWrapper.create_eternal(() => iterate_definition(...definition_tuple))
}

export function compute_decidable(
	main: [Definition, ScopeStack],
	known_against: [Definition, ScopeStack][],
	input_next: [Node, ScopeStack][],
) {
	const next = input_next.slice()
	const against = [...known_against, ...gather_branches(next)]

	const [path, _] = _compute_decidable(
		AstIter(main),
		against.map(AstIter),
		new PathBuilder(),
	)
	return path
}

function _compute_decidable(
	main: AstIter,
	input_against: AstIter[],
	builder: PathBuilder,
) {
	let against = input_against.slice()

	let item
	while (item = main.next()) {
		// console.log('beginning iteration')
		// console.log('item', item)
		// console.log('against.length', against.length)

		// this next call will already mutate the underlying definition in gather_branches
		// so we could have entered this iteration of the loop with many things ahead
		// but the next will have none left

		if (Array.isArray(item)) {
			if (item.length === 0)
				throw new Error('empty definition')

			// console.log('recursing')

			const new_against = [] as AstIter[]
			const decision_paths = []

			for (const definition_tuple of item) {
				// console.log('definition_tuple[0]', definition_tuple[0])
				// it seems that *all* the exit states of the clone against iters of each definition
				// must be added to the new list of against
				const [decision_path, continued_against] = _compute_decidable(
					AstIter(definition_tuple),
					against.map(a => a.clone()),
					new PathBuilder(),
				)
				new_against.push_all(continued_against)
				decision_paths.push(decision_path)
			}
			against = new_against

			// console.log('decision_paths', decision_paths)
			builder.push_branch(decision_paths)
			if (against.length === 0)
				break
			continue
		}

		if (is_continue(item))
			// since we've placed an against.length check before this,
			// hitting here means this thing is undecidable, at least for now
			throw new Error('undecidable')


		const new_against = [] as AstIter[]
		const against_iters = against.slice()

		let against_iter: AstIter
		while (against_iter = against_iters.shift()!) {
			const against_item = against_iter.next()
			if (against_item === undefined)
				continue

			// console.log('against_item', against_item)

			if (Array.isArray(against_item)) {
				const child_iters = against_item.map(
					definition_tuple => IterWrapper.chain_iters(AstIter(definition_tuple), against_iter.clone()),
				)
				against_iters.push_all(child_iters)
				continue
			}

			if (is_continue(against_item)) {
				// we'll just keep cycling this iterator over and over
				// that's a safe choice since the main loop will die if it also has one
				against_iters.push(EternalAstIter(against_item.definition_tuple))
				continue
			}

			if (item !== against_item)
				continue

			new_against.push(against_iter)
		}
		against = new_against

		builder.push(item)
		if (against.length === 0)
			break
	}


	// against.length being non-zero here means that we exhausted the main branch before the others
	// we could choose to make that an error condition, but it seems too picky
	// for example, what about this: (A, B, C)? (A, B, C, D)
	// that's a situation that might make perfect sense,
	// since the Maybe only happens once, the next could definitely happen
	// it definitely means you need to warn people that the first matched rule in an Or will be taken,
	// so they should put longer ones first if they share stems

	// console.log('returning')
	// console.log('against.length', against.length)
	// console.log()
	return t(builder.build(), against)
}
