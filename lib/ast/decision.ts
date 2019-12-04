import '@ts-std/extensions/dist/array'
import { Dict } from '@ts-std/types'
import { Data } from '../utils'

import { TokenDef } from './ast'
import { Lexer, LexerState, TokenDefinition, Token, match_and_trim } from '../lexer'

export abstract class Decidable {
	abstract readonly test_length: number
	abstract test<V extends Dict<any>>(
		lexer: Lexer<V>,
		lexer_state?: LexerState<V>,
	): [Token[], LexerState<V>] | undefined
}

export class PathBuilder {
	private items = [] as (TokenDef[] | AstDecisionBranch)[]

	push_branch(paths: AstDecisionPath[]) {
		this.items.push(AstDecisionBranch(
			...paths.filter(path => path.test_length > 0)
		))
	}

	push(def: TokenDef) {
		const last_index = this.items.length - 1
		const last = this.items[last_index]
		if (this.items.length === 0 || !Array.isArray(last)) {
			this.items.push([def])
			return
		}
		last.push(def)
	}

	build() {
		const last_index = this.items.length - 1
		const last = this.items.maybe_get(-1)
		if (last.is_some() && !Array.isArray(last.value) && last.value.is_optional)
			this.items.splice(last_index, 1)

		return AstDecisionPath(...this.items)
	}
}

export const AstDecisionPath = Data((...path: (TokenDef[] | AstDecisionBranch)[]): AstDecisionPath => {
	return { type: 'AstDecisionPath' as const, path, test_length: compute_path_test_length(path) }
})
export type AstDecisionPath = Readonly<{ type: 'AstDecisionPath', path: (TokenDef[] | AstDecisionBranch)[], test_length: number }>

export const AstDecisionBranch = Data((...paths: AstDecisionPath[]): AstDecisionBranch => {
	const is_optional = paths.length === 1
	const test_length = Math.max(...paths.map(p => p.test_length))
	return { type: 'AstDecisionBranch' as const, is_optional, paths: paths.slice(), test_length }
})
export type AstDecisionBranch = Readonly<{ type: 'AstDecisionBranch', is_optional: boolean, paths: AstDecisionPath[], test_length: number }>
export type AstDecidable = AstDecisionPath | AstDecisionBranch

interface HasTestLength {
	readonly test_length: number
}
function compute_path_test_length<T>(path: (T[] | HasTestLength)[]) {
	return path.map(
		item => Array.isArray(item)
			? item.length
			: item.test_length
	).sum()
}


export function path(...path: (TokenDefinition[] | DecisionBranch)[]) {
	return new DecisionPath(path)
}
class DecisionPath extends Decidable {
	readonly type = 'DecisionPath'
	readonly test_length: number
	constructor(
		readonly path: readonly (TokenDefinition[] | DecisionBranch)[],
	) {
		super()
		this.test_length = compute_path_test_length(path as (TokenDefinition[] | HasTestLength)[])
	}

	test<V extends Dict<any>>(
		lexer: Lexer<V>,
		input_lexer_state?: LexerState<V>,
	): [Token[], LexerState<V>] | undefined {
		const tokens = [] as Token[]
		let lexer_state = input_lexer_state

		for (const item of this.path) {
			const attempt = Array.isArray(item)
				? lexer.test(item, lexer_state)
				: item.test(lexer, lexer_state)
			if (attempt === undefined)
				return undefined

			const [consumed_tokens, new_lexer_state] = attempt
			tokens.push_all(consumed_tokens)
			lexer_state = new_lexer_state
		}

		return [tokens, lexer_state as LexerState<V>]
	}
}



export function branch(...paths: DecisionPath[]) {
	return new DecisionBranch(paths)
}
class DecisionBranch extends Decidable {
	readonly type = 'DecisionBranch'
	readonly test_length: number
	readonly paths: readonly DecisionPath[]
	readonly is_optional: boolean
	constructor(
		paths: DecisionPath[],
	) {
		super()
		if (paths.length === 0)
			throw new Error("DecisionBranch was constructed with an empty list")

		this.is_optional = paths.length === 1
		this.paths = paths.slice()
		this.test_length = Math.max(...paths.map(p => p.test_length))
	}

	test<V extends Dict<any>>(
		lexer: Lexer<V>,
		lexer_state?: LexerState<V>,
	): [Token[], LexerState<V>] | undefined {
		for (const path of this.paths) {
			const attempt = path.test(lexer, lexer_state)
			if (attempt === undefined)
				continue
			return attempt
		}

		return undefined
	}
}
