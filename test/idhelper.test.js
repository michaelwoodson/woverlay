'use strict';

let test = require('tape');
let idmaker = require('./lib/idmaker');
let idhelper = require('../lib/idhelper');

test('closest', function(t) {
	let ids = [idmaker('01'), idmaker('43'), idmaker('62') , idmaker('7B'), idmaker('AA'), idmaker('CC'), idmaker('DD')];
	t.ok(idhelper.closest(idmaker('FB'),ids).substring(0,2) == '01', 'closest should wrap');
	t.ok(idhelper.closest(idmaker('49'),ids).substring(0,2) == '43', 'closest should go backwards');
	t.end();
});


test('converttoidstring', function(t) {
	t.equals(idhelper.convertToIdString('1'), '00000000000000000000000000000000000000000000000000000000000000001', 'zero padding');
	t.end();
});
