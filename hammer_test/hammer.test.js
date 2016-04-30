"use strict"

let test = require('tape');

const PORT = 5001;
process.env.PORT = PORT;

let server = require('../lib/server');
let browserify = require('browserify');
let run = require('tape-run');

server.startup();

browserify('./browser.hammer.js').ignore('ws').bundle().pipe(run()).on('results', (results) => {
	if (!results.ok) {
		process.exit(1);
	}
	console.log('shutting down server');
	server.shutdown();
	test('verify server', function(t) {
		t.equals(server.status.verifiedCount, 5, 'verified all overlay networks');
		t.end();
	});
}).pipe(process.stdout);

