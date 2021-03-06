import { Dict } from '@ts-std/types'

import { debug, NonEmpty } from '../utils'
import { Decidable } from './decision'
import {
	Lexer as _Lexer,
	TokenDefinition, RawTokenDefinition, RawToken,
	ContentVirtualTokenDefinition, ContentVirtualToken,
	EmptyVirtualTokenDefinition, EmptyVirtualToken,
	TokenSpec, VirtualLexerOutputs,
} from './lexer'

type Lexer = _Lexer<VirtualLexerOutputs>

export function Parser<D extends Dict<TokenSpec>, V extends VirtualLexerOutputs = {}>(
	tokens: D,
	virtual_lexer_outputs: V,
) {
	const [tok, lexer] = _Lexer.create(tokens, virtual_lexer_outputs)

	return {
		tok,
		reset(...args: Parameters<Lexer['reset']>) {
			lexer.reset(...args)
		},
		lock(token_definition: RawTokenDefinition) {
			return lock(lexer, token_definition)
		},
		consume<L extends TokenDefinition[]>(...token_definitions: L) {
			return consume(lexer, token_definitions)
		},
		maybe<E extends ParseEntity>(...entity: E) {
			return maybe(lexer, entity)
		},
		or<C extends ParseEntity[]>(...choices: C) {
			return or(lexer, choices)
		},
		maybe_or<C extends ParseEntity[]>(...choices: C) {
			return maybe_or(lexer, choices)
		},
		many_or<C extends ParseEntity[]>(...choices: C) {
			return many_or(lexer, choices)
		},
		maybe_many_or<C extends ParseEntity[]>(...choices: C) {
			return maybe_many_or(lexer, choices)
		},
		many<E extends ParseEntity>(...entity: E) {
			return many(lexer, entity)
		},
		maybe_many<E extends ParseEntity>(...entity: E) {
			return maybe_many(lexer, entity)
		},
		exit() {
			lexer.exit()
		},
	}
}

type Func = (...args: any[]) => any

type DecidableFunc<F extends Func> =
	((fn: F, d: Decidable, ...args: Parameters<F>) => any) extends ((...args: infer R) => any)
	? R
	: never

function is_decidable_func<F extends Func>(
	fl: DecidableFunc<F> | TokenDefinition[] | [Locker],
): fl is DecidableFunc<F> {
	return fl.length > 1 && typeof fl[0] === 'function'
}

// type ArgFunc<F extends Func> =
// 	((fn: F, ...args: Parameters<F>) => any) extends ((...args: infer R) => any)
// 	? R
// 	: never

// export function a<F extends Func>(fn: F, ...args: Parameters<F>): ArgFunc<F> {
// 	return [fn, ...args] as ArgFunc<F>
// }

export type ParseEntity = DecidableFunc<Func> | TokenDefinition[] | ([Locker])
export type ParseArg = () => any

export type TokensForDefinitions<L extends TokenDefinition[]> = {
	[K in keyof L]:
		L[K] extends ContentVirtualTokenDefinition ? ContentVirtualToken
		: L[K] extends EmptyVirtualTokenDefinition ? EmptyVirtualToken
		: RawToken
}


type EntityReturn<E extends ParseEntity> =
	E extends [Locker] ? [RawToken]
	: E extends TokenDefinition[] ? TokensForDefinitions<E>
	: ((...args: E) => any) extends ((fn: infer F, d: Decidable, ...args: infer A) => any)
	? F extends Func
	? A extends Parameters<F>
	? ReturnType<F>
	: never : never : never

function is_locker_tuple(entity: TokenDefinition[] | [Locker]): entity is [Locker] {
	return entity.length === 1 && 'attempt_locker' in entity[0]
}

function perform_entity<E extends ParseEntity>(
	lexer: Lexer,
	entity: E,
): EntityReturn<E> {
	if (is_decidable_func(entity)) {
		const [fn, , ...args] = entity
		return fn(...args)
	}
	if (is_locker_tuple(entity)) {
		return entity[0]()
	}
	return lexer.require(entity as TokenDefinition[]) as EntityReturn<E>
}

function test_entity<E extends ParseEntity>(
	lexer: Lexer,
	entity: E,
): boolean {
	if (is_decidable_func(entity)) {
		const [, tester, ] = entity
		return tester.test(lexer) !== undefined
	}
	if (is_locker_tuple(entity)) {
		return entity[0].attempt_locker()
	}
	return lexer.test(entity as TokenDefinition[]) !== undefined
}

function consume<L extends TokenDefinition[]>(
	lexer: Lexer,
	token_definitions: L
): TokensForDefinitions<L> {
	return lexer.require(token_definitions) as TokensForDefinitions<L>
}

type Locker = (() => RawToken) & { attempt_locker: () => boolean }
function lock(lexer: Lexer, token_definition: RawTokenDefinition): Locker {
	let locked = undefined as RawToken | undefined
	const locker: Locker = () => {
		const [token] = perform_entity(lexer, [token_definition] as [RawTokenDefinition]) as [RawToken]

		if (locked !== undefined) {
			if (locked.type.name !== token.type.name || locked.content !== token.content)
				throw new Error(`unexpected locked Token, expected ${locked} got ${token}`)
			return token
		}
		locked = token
		return token
	}
	locker.attempt_locker = () => {
		const should_proceed = test_entity(lexer, [token_definition] as [RawTokenDefinition])
		if (!should_proceed)
			return false
		if (locked === undefined)
			return true

		const [token] = perform_entity(lexer, [token_definition] as [RawTokenDefinition]) as [RawToken]
		return !(locked.type.name !== token.type.name || locked.content !== token.content)
	}
	return locker
}


type Optional<T, B extends boolean> = B extends true ? T | undefined : T

function maybe<E extends ParseEntity>(
	lexer: Lexer,
	entity: E
): EntityReturn<E> | undefined {
	if (test_entity(lexer, entity))
		return perform_entity(lexer, entity)

	return undefined
}

// function test_next_matches(lexer: Lexer, next_decidable?: Decidable) {
// 	return next_decidable && next_decidable.test(lexer) !== undefined
// }

// function many_unless<E extends ParseEntity>(
// 	lexer: Lexer,
// 	next_decidable: Decidable, entity: E,
// ): NonEmpty<EntityReturn<E>> {
// 	return _many(lexer, false, entity, next_decidable)
// }
// function maybe_many_unless<E extends ParseEntity>(
// 	lexer: Lexer,
// 	next_decidable: Decidable, entity: E,
// ): NonEmpty<EntityReturn<E>> | undefined {
// 	return _many(lexer, true, entity, next_decidable)
// }

function many<E extends ParseEntity>(
	lexer: Lexer,
	entity: E
): NonEmpty<EntityReturn<E>> {
	return _many(lexer, false, entity)
}

function maybe_many<E extends ParseEntity>(
	lexer: Lexer,
	entity: E
): NonEmpty<EntityReturn<E>> | undefined {
	return _many(lexer, true, entity)
}

function _many<E extends ParseEntity, B extends boolean>(
	lexer: Lexer,
	is_optional: B,
	entity: E,
	// next_decidable?: Decidable,
): Optional<NonEmpty<EntityReturn<E>>, B> {
	// const next_matches = test_next_matches(lexer, next_decidable)
	// let should_proceed = !is_optional || (test_entity(lexer, entity) && !next_matches)
	let should_proceed = !is_optional || test_entity(lexer, entity)
	if (is_optional && !should_proceed)
		return undefined as Optional<NonEmpty<EntityReturn<E>>, B>

	const results = [] as unknown as NonEmpty<EntityReturn<E>>

	while (should_proceed) {
		results.push(perform_entity(lexer, entity))
		// const next_matches = test_next_matches(lexer, next_decidable)
		// should_proceed = test_entity(lexer, entity) && !next_matches
		should_proceed = test_entity(lexer, entity)
	}

	return results as Optional<NonEmpty<EntityReturn<E>>, B>
}



export type ChoicesReturn<C extends ParseEntity[]> = {
	[K in keyof C]: EntityReturn<C[K] extends ParseEntity ? C[K] : never>
}[number]

export function c<C extends ParseEntity>(...choice: C): C {
	return choice
}

function or<C extends ParseEntity[]>(
	lexer: Lexer,
	choices: C
): ChoicesReturn<C> {
	return _or(lexer, false, choices) as ChoicesReturn<C>
}

function maybe_or<C extends ParseEntity[]>(
	lexer: Lexer,
	choices: C
): ChoicesReturn<C> | undefined {
	return _or(lexer, true, choices) as ChoicesReturn<C> | undefined
}
function many_or<C extends ParseEntity[]>(
	lexer: Lexer,
	choices: C,
): NonEmpty<ChoicesReturn<C>> {
	const results = [_or(lexer, false, choices)] as NonEmpty<ChoicesReturn<C>>

	let result
	while (result = _or(lexer, true, choices))
		results.push(result)

	return results
}
function maybe_many_or<C extends ParseEntity[]>(
	lexer: Lexer,
	choices: C,
): NonEmpty<ChoicesReturn<C>> | undefined {
	const results = [] as ChoicesReturn<C>[]
	let result
	while (result = _or(lexer, true, choices))
		results.push(result)

	return results.length !== 0 ? results as NonEmpty<ChoicesReturn<C>> : undefined
}

function _or<C extends ParseEntity[], B extends boolean>(
	lexer: Lexer,
	is_optional: B,
	choices: C,
): Optional<ChoicesReturn<C>, B> {
	for (const choice of choices) {
		if (!test_entity(lexer, choice))
			continue

		return perform_entity(lexer, choice) as Optional<ChoicesReturn<C>, B>
	}

	if (is_optional)
		return undefined as Optional<ChoicesReturn<C>, B>

	const next_source = lexer.get_next_source()
	throw new Error(`expected one of these choices:\n${debug(choices)}\n\nbut got this:\n${next_source}\n`)
}
