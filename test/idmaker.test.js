'use strict';

let test = require('tape');
let idmaker = require('./lib/idmaker');

test('make id', function(t) {
	let testId = idmaker('c3');
	t.ok(testId.length == 64);
	t.ok(testId.indexOf('c3') == 0);
	t.end();
});

test('random id', function(t) {
	t.notOk(idmaker('0') == idmaker('0'));
	t.end();
});
