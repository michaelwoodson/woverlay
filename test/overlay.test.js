'use strict';

let test = require('tape');
let idmaker = require('./lib/idmaker');
let Overlay = require('../lib/overlay').Overlay;

test('wrap index', function(t) {
	t.ok(Overlay.wrapIndex(-2, 10) == 8, 'negative index wrapped');
	t.ok(Overlay.wrapIndex(5, 10) == 5, 'in bound index stays the same');
	t.ok(Overlay.wrapIndex(11, 10) == 1, 'big index brought into range');
	t.end();
});

test('make flood', function(t) {
	let localid = idmaker('0F');
	let connections = [localid, idmaker('13'), idmaker('32') , idmaker('7B'), idmaker('AA'), idmaker('CC'), idmaker('DD')];
	Overlay.FLOOD_SIZE = 1;
	let flood = Overlay.makeFlood(connections, localid);
	t.ok(flood[0].substring(0,2) == 'DD', 'wrapped value at start');
	t.ok(flood[1] == localid, 'local at center');
	t.ok(flood[2].substring(0,2) == '13', 'expected right side');
	t.end();
});

test('in flood range', function(t) {
	let overlay = new Overlay();
	overlay.targetFlood = () => [idmaker('01'), idmaker('FF'), idmaker('11'), idmaker('22'), idmaker('33')];
	t.ok(overlay.inFloodRange(idmaker('02')), 'flood range');
	t.ok(!overlay.inFloodRange(idmaker('34')), 'outside flood range');
	overlay.targetFlood = () => [idmaker('CC'), idmaker('FF'), idmaker('11'), idmaker('22'), idmaker('33')];
	t.ok(overlay.inFloodRange(idmaker('CD')), 'flood range when wrapping');
	t.ok(!overlay.inFloodRange(idmaker('CB')), 'outside flood range when wrapping');
	overlay.targetFlood = () => [idmaker('FF'), idmaker('11'), idmaker('22'), idmaker('33')];
	t.ok(overlay.inFloodRange(idmaker('88')), 'everything in range in small network');
	t.end();
});

test ('pick finger', function(t) {
	let overlay = new Overlay();
	let bestFinger = overlay.bestFinger(idmaker('00'), 0, idmaker('80'), idmaker('70'));
	t.ok(bestFinger.substring(0,2) == '80', 'pick best finger');
	t.end();
});
