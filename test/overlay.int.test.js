"use strict"

const PORT = 5001;
process.env.PORT = PORT;
let server = require('../lib/server');
server.startup();

let browserify = require('browserify');
let run = require('tape-run');

browserify(require.resolve('./browser.overlay.js')).bundle().pipe(run()).on('results', (results) => {
	if (!results.ok) {
		process.exit(1);
	}
	server.shutdown();
}).pipe(process.stdout);

