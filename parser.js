class ParserInput {
    constructor(data, offset) {
        this.data = data;
        this.offset = offset || 0;
    }

    split(at) {
        let left = new ParserInput(this.data.slice(0, at), this.offset);
        let right = new ParserInput(this.data.slice(at), this.offset + at);

        let ret = [left, right];

        ret.left = function() { return this[0]; };
        ret.right = function() { return this[1]; };

        return ret;
    }
}


class ParserError extends Error {
    constructor(input, parser, message) {
        super();

        this.msg = message || ("expected " + parser.expects());
        this.input = input;
        this.parser = parser;
    }

    get message() {
        return `at ${this.input.offset} ` + this.msg + ' got ' + this.input.data[0] || 'end of input';
    }
}


class Rule {
    expect_hint(expectation) {
        this.expectation = expectation;
        return this;
    }

    hide() {
        this.hidden = true;
        return this;
    }

    expects() {
        return this.expectation;
    }

    error(input, message) {
        throw new ParserError(input, this, message);
    }

    map(func) {
        return new Map(this, func);
    }

    named(...names) {
        return new Map(this, arr => {
            let obj = {};

            names.forEach((name, i) => {
                obj[name] = arr[i];
            });

            return obj;
        });
    }

    branch(name) {
        return new Map(this, res => ({
            branch: name,
            value: res,
        }));
    }

    opt() {
        return new Many(this)
            .at_most(1)
            .map((arr) => arr.length === 0 ? null : arr[0]);
    }
}

class Exact extends Rule {
    constructor(word) {
        super();

        this.word = word
        this.expect_hint("'" + word + "'");
    }

    ignore_case() {
        this._ignore_case = true;
        return this;
    }

    parse(input) {
        let matches = null;

        if (this._ignore_case) {
            const lc = this.word.toLowerCase();
            matches = lc === input.data.slice(0, lc.length).toLowerCase();
        } else {
            matches = input.data.startsWith(this.word);
        }

        if (matches) {
            let [result, rest] = input.split(this.word.length)
            return [result.data, rest];
        } else {
            this.error(input);
        }
    }
}

class Chain extends Rule {
    constructor() {
        super();

        this.chain = [];
    }

    expects() {
        return 'chain [' +
            this.chain
            .map(p => p.expects())
            .join(', ') +
            ']';
    }

    with(parser) {
        this.chain.push(to_parser(parser));
        if (this.spaces) {
            this.with_spaces();
        }
        return this;
    }

    with_hidden(parser) {
        this.chain.push(to_parser(parser).hide());
        if (this.spaces) {
            this.with_spaces();
        }
        return this;
    }

    with_spaces() {
        this.chain.push(new Spaces().hide());
        return this;
    }

    interleave_spaces() {
        this.spaces = true;
        if (this.chain.length === 0 ||
            !(this.chain[this.chain.length] instanceof Spaces)) {

            this.with_spaces();
        }
        return this;
    }

    no_interleave_spaces() {
        this.spaces = false;
        if (this.chain.length !== 0 &&
            this.chain[this.chain.length] instanceof Spaces) {

            this.chain.pop();
        }
        return this;
    }

    parse(input) {
        return this.chain.reduce(
            ([done, rest], parser) => {
                let [result, new_rest] = parser.parse(rest);
                if (!parser.hidden) {
                    done.push(result);
                }
                return [done, new_rest];
            },
            [[], input]
        );
    }
}

class Many extends Rule {
    constructor(parser) {
        super();

        this.parser = to_parser(parser);
        this.at_least_n = 0;
        this.at_most_n = null;
    }

    at_least(n) {
        this.at_least_n = n;
        return this;
    }

    at_most(n) {
        this.at_most_n = n;
        return this;
    }

    expects() {
        const at_most = () => {
            if (this.at_most_n == null) {
                return '';
            } else {
                return `and at most ${this.at_most_n} `;
            }
        };

        if (!this.parser.hidden) {
            return `at least ${this.at_least_n} ${at_most()}${this.parser.expects()}`;
        } else {
            return '';
        }
    }

    got_enough(results) {
        return results.length >= this.at_least_n;
    }

    got_maximum(results) {
        if (this.at_most_n == null) {
            return false;
        } else {
            return results.length >= this.at_most_n;
        }
    }

    parse(input) {
        let results = [];

        try {
            while (true) {
                let [result, rest] = this.parser.parse(input);
                results.push(result);
                if (rest.offset === input.offset) {
                    break;
                }
                input = rest;

                if (this.got_maximum(results)) {
                    break;
                }
            }
        } catch (e) {
            if (!(e instanceof ParserError)) {
                throw e;
            }
        }

        if (!this.got_enough(results)) {
            this.error(input);
        }

        return [results, input];
    }
}

class Either extends Rule {
    constructor() {
        super();

        this.either = [];
    }

    expects() {
        return 'one of (' +
            this.either
            .map(p => p.expects())
            .join(' | ') +
            ')';
    }

    with(parser) {
        this.either.push(to_parser(parser));
        return this;
    }

    with_hidden(parser) {
        this.either.push(to_parser(parser).hide());
        return this;
    }

    parse(input) {
        if (this.either.length === 0) {
            throw new Error('Either rule must have at least one variant');
        }

        for (const parser of this.either) {
            try {
                return parser.parse(input);
            } catch (e) {
                if (!(e instanceof ParserError)) {
                    throw e;
                }
            }
        }

        this.error(input);
    }
}

class Spaces extends Rule {
    constructor() {
        super();
        this.expect_hint('spaces');
        this.hide();
    }

    parse(input) {
        let spaces = input.data.match(/^\s*/);
        if (spaces) {
            return [spaces[0], input.split(spaces[0].length).right()];
        }
        else {
            return ['', input];
        }
    }
}

class Map extends Rule {
    constructor(parser, func) {
        super();

        this.parser = to_parser(parser);
        this.func = func;
    }

    expects() {
        return this.parser.expects();
    }

    parse(input) {
        let [result, rest] = this.parser.parse(input);
        return [this.func(result), rest];
    }
}

class Pred extends Rule {
    constructor(pred) {
        super();

        this.pred = pred;
        this.expect_hint('character matching a predicate');
    }

    parse(input) {
        if (!this.pred(input.data[0])) {
            this.error(input);
        } else {
            return [input.data[0], input.split(1).right()];
        }
    }

    static eoi() {
        return new Pred(x => x === undefined).expect_hint('end of input');
    }
}

class Regex extends Rule {
    constructor(regex) {
        super();

        let str = String(regex);
        str = str.slice(1);
        str = str.slice(0, str.length-1);
        if (!str.startsWith('^')) {
            str = '^' + str;
        }

        this.regex = RegExp(str);
        this.expect_hint(`regex ${regex}`);
    }

    parse(input) {
        let matches = input.data.match(this.regex);
        if (matches) {
            return [matches, input.split(matches[0].length).right()];
        } else {
            this.error(input);
        }
    }
}

function to_parser(x) {
    if (typeof(x) !== 'object') {
        return new Exact(String(x));
    } else if (x instanceof Rule) {
        return x;
    } else if (x instanceof RegExp) {
        return new Regex(x).map(m => m[0]);
    } else {
        throw new Error('Not a parser');
    }
}

module.exports = {
    ParserError,
    ParserInput,
    Rule,
    Exact,
    Chain,
    Many,
    Either,
    Spaces,
    Map,
    Pred,
    Regex,
};
