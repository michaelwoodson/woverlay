"use strict"

let test = require('tape');
let idmaker = require('./lib/idmaker');
let Overlay = require('../lib/overlay').Overlay;
let LocalID = require('../lib/localid').LocalID;

test('wrap index', function(t) {
	t.ok(Overlay.wrapIndex(-2, 10) == 8);
	t.ok(Overlay.wrapIndex(5, 10) == 5);
	t.ok(Overlay.wrapIndex(11, 10) == 1);
	t.end();
});

test('make fload', function(t) {
	let localid = idmaker('0F');
	let connections = [localid, idmaker('13'), idmaker('32') , idmaker('7B'), idmaker('AA'), idmaker('CC'), idmaker('DD')];
	Overlay.FLOOD_SIZE = 1;
	let flood = Overlay.makeFlood(connections, localid);
	t.ok(flood[0].substring(0,2) == 'DD');
	t.ok(flood[1] == localid);
	t.ok(flood[2].substring(0,2) == '13');
	t.end();
});
