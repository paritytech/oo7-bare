// (C) Copyright 2016-2017 Parity Technologies (UK) Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//         http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const Bond = require('./bond');

function isArrayWithNonPlainItems (x, depthLeft) {
	return depthLeft > 0 && x.constructor === Array && (
		(depthLeft === 1 && x.findIndex(i => Bond.instanceOf(i) || i instanceof Promise) !== -1
		) || (depthLeft > 1 && x.findIndex(i => Bond.instanceOf(i) || i instanceof Promise || i instanceof Array || i instanceof Object) !== -1)
	);
}

function isObjectWithNonPlainItems (x, depthLeft) {
	return depthLeft > 0 && x.constructor === Object && (
		(depthLeft === 1 && Object.keys(x).findIndex(i => Bond.instanceOf(x[i]) || x[i] instanceof Promise) !== -1) ||
			(depthLeft > 1 && Object.keys(x).findIndex(i => Bond.instanceOf(x[i]) || x[i] instanceof Promise || x[i] instanceof Array || x[i] instanceof Object) !== -1)
	);
}

function isReady (x, depthLeft) {
	if (typeof x === 'object' && x !== null) {
		if (Bond.instanceOf(x)) {
			return x._ready;
		} else if (x instanceof Promise) {
			return typeof x._value !== 'undefined';
		} else if (depthLeft > 0 && x.constructor === Array) {
			return x.every(i => isReady(i, depthLeft - 1));
		} else if (depthLeft > 0 && x.constructor === Object) {
			return Object.keys(x).every(k => isReady(x[k], depthLeft - 1));
		}
	}

	return true;
}

function deepNotify (x, poll, ids, depthLeft) {
	// console.log(`Setitng up deep notification on object: ${JSON.stringify(x)} - ${typeof(x)}/${x === null}/${x.constructor.name} (depthLeft: ${depthLeft})`);
	if (typeof x === 'object' && x !== null) {
		if (Bond.instanceOf(x)) {
			ids.push(x.notify(poll));
			return true;
		} else if (x instanceof Promise) {
			x.then(v => { x._value = v; poll(); });
			return true;
		} else if (isArrayWithNonPlainItems(x, depthLeft)) {
			let r = false;
			x.forEach(i => { r = deepNotify(i, poll, ids, depthLeft - 1) || r; });
			return r;
		} else if (isObjectWithNonPlainItems(x, depthLeft)) {
			let r = false;
			Object.keys(x).forEach(k => { r = deepNotify(x[k], poll, ids, depthLeft - 1) || r; });
			return r;
		} else {
			return false;
		}
	} else {
		return false;
	}
}

function deepUnnotify (x, ids, depthLeft) {
	if (typeof x === 'object' && x !== null) {
		if (Bond.instanceOf(x)) {
			x.unnotify(ids.shift());
			return true;
		} else if (isArrayWithNonPlainItems(x, depthLeft)) {
			let r = false;
			x.forEach(i => { r = deepUnnotify(i, ids, depthLeft - 1) || r; });
			return r;
		} else if (isObjectWithNonPlainItems(x, depthLeft)) {
			let r = false;
			Object.keys(x).forEach(k => { r = deepUnnotify(x[k], ids, depthLeft - 1) || r; });
			return r;
		} else {
			return false;
		}
	} else {
		return false;
	}
}

function mapped (x, depthLeft) {
	if (!isReady(x, depthLeft)) {
		throw new Error(`Internal error: Unready value being mapped`);
	}
	// console.log(`x info: ${x} ${typeof(x)} ${x.constructor.name} ${JSON.stringify(x)}; depthLeft: ${depthLeft}`);
	if (typeof x === 'object' && x !== null) {
		if (Bond.instanceOf(x)) {
			if (x._ready !== true) {
				throw new Error(`Internal error: Unready Bond being mapped`);
			}
			if (typeof x._value === 'undefined') {
				throw new Error(`Internal error: Ready Bond with undefined value in mapped`);
			}
			// console.log(`Bond: ${JSON.stringify(x._value)}}`);
			return x._value;
		} else if (x instanceof Promise) {
			if (typeof x._value === 'undefined') {
				throw new Error(`Internal error: Ready Promise has undefined value`);
			}
			// console.log(`Promise: ${JSON.stringify(x._value)}}`);
			return x._value;
		} else if (isArrayWithNonPlainItems(x, depthLeft)) {
			// console.log(`Deep array...`);
			let o = x.slice().map(i => mapped(i, depthLeft - 1));
			// console.log(`...Deep array: ${JSON.stringify(o)}`);
			return o;
		} else if (isObjectWithNonPlainItems(x, depthLeft)) {
			var o = {};
			// console.log(`Deep object...`);
			Object.keys(x).forEach(k => { o[k] = mapped(x[k], depthLeft - 1); });
			// console.log(`...Deep object: ${JSON.stringify(o)}`);
			return o;
		} else {
			// console.log(`Shallow object.`);
			return x;
		}
	} else {
		// console.log(`Basic value.`);
		return x;
	}
}

/**
 * @summary A {@link Bond} which retains dependencies on other {@link Bond}s.
 * @description This inherits from the {@link Bond} class, providing its full API,
 * but also allows for dependencies to other `Bond`s to be registered. When
 * any dependency changes value (or _readiness_), a callback is executed and
 * is passed the new set of underlying values corresponding to each dependency.
 *
 * The callback is made if and only if this object is in use (i.e. {@link Bond#use}
 * or one of its dependents has been called).
 */
class ReactiveBond extends Bond {
	/**
	 * Constructs a new object.
	 *
	 * @param {array} args - Each item that this object's representative value
	 * is dependent upon, and which needs to be used by the callback function
	 * (presumably to determine that value to be passed into {@link Bond#changed}).
	 * @param {array} deps - {@link Bond}s or {Promise}s that the representative
	 * value is dependent on, but which are not needed for passing into the
	 * callback.
	 * @param {function} execute - The callback function which is called when
	 * any item of `args` or `deps` changes its underlying value. A value corresponding
	 * to each item in `args` are passed to the callback:
	 * items that are {@link Bond}s are resolved to the value they represent before
	 * being passed into the callback `execute` function. {Promise} objects are
	 * likewise resolved for their underlying value. Structures such as arrays
	 * and objects are traversed recursively and likewise interpreted. Other
	 * types are passed straight through.
	 * The callback is only made when all items of `args` are considered _ready_.
	 * @param {boolean} mayBeNull - Noramlly, `null` is a valid value for dependent `Bond`s
	 * and `Promise`s to represent. Pass `false` here to disallow `null` to be
	 * considered valid (and thus any `null` dependencies in `args` will mean that
	 * dependency is considered not _ready_ and no callback will happen).
	 * @defaultValue true
	 * @param {number} resolveDepth - The maximum number of times to recurse into
	 * arrays or objects of `args` items in searching for {@link Bond}s or {Promise}s
	 * to resolve.
	 * @defaultValue 1
	 */
	constructor (args, deps, execute, mayBeNull = true, resolveDepth = 1) {
		super(mayBeNull);

		execute = execute || this.changed.bind(this);

		this._poll = () => {
			// console.log(`Polling ReactiveBond with resolveDepth ${resolveDepth}`);
			if (args.every(i => isReady(i, resolveDepth))) {
				// console.log(`poll: All dependencies good...`, a, resolveDepth);
				let mappedArgs = args.map(i => mapped(i, resolveDepth));
				// console.log(`poll: Mapped dependencies:`, am);
				execute.bind(this)(mappedArgs);
			} else {
				// console.log("poll: One or more dependencies undefined");
				this.reset();
			}
		};
		this._active = false;
		this._deps = deps.slice();
		this._args = args.slice();
		this._resolveDepth = resolveDepth;
	}

	// TODO: implement isDone.
	initialise () {
		// console.log(`Initialising ReactiveBond for resolveDepth ${this.resolveDepth}`);
		this._ids = [];
		this._deps.forEach(_ => this._ids.push(_.notify(this._poll)));
		var nd = 0;
		this._args.forEach(i => {
			if (deepNotify(i, this._poll, this._ids, this._resolveDepth)) nd++;
		});
		if (nd === 0 && this._deps.length === 0) {
			this._poll();
		}
	}

	finalise () {
		// console.log(`Finalising ReactiveBond with resolveDepth ${this.resolveDepth}`);
		this._deps.forEach(_ => _.unnotify(this._ids.shift()));
		this._args.forEach(_ => deepUnnotify(_, this._ids, this._resolveDepth));
	}
}

module.exports = ReactiveBond;
