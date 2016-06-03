"use strict";

let test = require('tape');
let array = require('../lib/array');

test('add', function(t) {
	let testArray = ['a', 'b', 'c'];
	array.add(testArray, 'd');
	t.ok(testArray.length == 4, 'Do add new things.');
	array.add(testArray, 'a');
	t.ok(testArray.length == 4, 'Only add once.');
	t.end();
});

test('remove', function(t) {
	let testArray = ['a', 'b', 'c'];
	array.remove(testArray, 'a');
	t.ok(testArray.length == 2, 'Remove if present.');
	array.remove(testArray, 'd');
	t.ok(testArray.length == 2, 'Ignore missing things.');
	t.end();
});
