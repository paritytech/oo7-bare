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

const ReactiveBond = require('./reactiveBond');

// Just a one-off.
class ReactivePromise extends ReactiveBond {
	constructor (a, d, execute = args => this.changed(args), mayBeNull = true, resolveDepth = 1) {
		let done = false;
		super(a, d, args => {
			if (!done) {
				done = true;
				execute.bind(this)(args);
			}
		}, mayBeNull, resolveDepth);
	}
}

module.exports = ReactivePromise;
