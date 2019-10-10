const { matchToken } = require('kreia-moo')

const EMPTY_BRANCH = Symbol()
const UNKNOWN_AFTER = Symbol()

function matchAndTrimTokens(tokens, tokenTypes) {
	for (const [index, tokenType] of tokenTypes.entries()) {
		const token = tokens[index]

		if (!matchToken(token, tokenType)) return false
	}

	tokens = tokens.slice()
	tokens.splice(0, tokenTypes.length)
	return tokens
}

class DecisionPath {
	constructor() {
		this.path = []
		this.maxLength = 0
		this.minLength = 0
	}

	push(tokenListOrBranch) {
		if (tokenListOrBranch instanceof DecisionPath) {
			this.path.push.apply(this.path, tokenListOrBranch.path)
		}
		else if (tokenListOrBranch !== UNKNOWN_AFTER && !(tokenListOrBranch instanceof DecisionBranch) && !(tokenListOrBranch instanceof Array)) {
			console.error(tokenListOrBranch)
			throw new Error("paths can only hold paths, arrays of tokens, or branches")
		}
		else this.path.push(tokenListOrBranch)
	}

	testAgainstTokens(tokenList) {
		let terminated = false
		for (const tokenListOrBranch of this.path) {
			// we matched to a point that we shouldn't continue matching past
			if (tokenListOrBranch === UNKNOWN_AFTER) {
				return [true, tokenList]
			}

			terminated = false
			if (tokenListOrBranch instanceof DecisionBranch) {
				// this replaces the tokenList with one that has been trimmed because of a successful match
				[, terminated, tokenList] = tokenListOrBranch.testAgainstTokens(tokenList)
			}
			else {
				tokenList = matchAndTrimTokens(tokenList, tokenListOrBranch)
			}

			if (terminated || tokenList === false) {
				return [terminated, tokenList]
			}
		}

		return [terminated, tokenList]
	}

	giveExpected() {
		const expectedPaths = []

		for (const path of this.path) {
			if (path === UNKNOWN_AFTER) return expectedPaths

			if (path instanceof Array) {
				expectedPaths.push(path)
				return expectedPaths
			}

			if (path instanceof DecisionBranch) {
				const [hasEmpty, branchExpectedPaths] = path.giveExpected()
				expectedPaths.push.apply(expectedPaths, branchExpectedPaths)
				if (!hasEmpty) return expectedPaths
			}
		}

		return expectedPaths
	}
}

class DecisionBranch {
	constructor() {
		this.branches = []
	}

	push(path) {
		if (!(path instanceof DecisionPath) && path !== EMPTY_BRANCH) {
			console.error(path)
			throw new Error("branches can only hold paths")
		}
		else this.branches.push(path)
	}

	testAgainstTokens(tokenList) {
		for (const [whichIndex, path] of this.branches.entries()) {
			// we got to the end of an optional branch
			if (path === EMPTY_BRANCH) {
				return [-1, false, tokenList]
			}

			const [terminated, newTokenList] = path.testAgainstTokens(tokenList)

			if (terminated || newTokenList !== false) {
				return [whichIndex, terminated, newTokenList]
			}
		}

		return [-1, false, false]
	}

	giveExpected() {
		const expectedPaths = []
		let hasEmpty = false
		for (const path of this.branches) {
			if (path !== EMPTY_BRANCH) expectedPaths.push(path)
			else hasEmpty = true
		}
		return [hasEmpty, expectedPaths]
	}
}

module.exports = { DecisionPath, DecisionBranch, EMPTY_BRANCH, UNKNOWN_AFTER }


// const trunk = new DecisionPath()
// trunk.push(['String', 'Space', 'LeftParen'])

// const branch = new DecisionBranch()
// const subPath = new DecisionPath()
// subPath.push(['Number', 'RightParen', 'Number'])
// branch.push(subPath)
// branch.push(EMPTY_BRANCH)
// trunk.push(branch)

// trunk.push(['Space', 'Number'])

// log(trunk)

// log(trunk.testAgainstTokens(['String', 'Space', 'LeftParen', 'Space', 'Number', 'stuff']))