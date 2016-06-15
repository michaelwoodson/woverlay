'use strict';

module.exports = function(moduleName, port, testFunction) {
	if (typeof window === 'undefined') {
		const PORT = port;
		process.env.PORT = PORT;
		// Hack to prevent browserify from trying to resolve server.
		let server = require('../../' + 'lib/server');
		server.startup();

		let browserify = require('browserify');
		let run = require('tape-run');
		let path = require('path');

		let settings = {};
		// use chrome for debugging
		//let settings = {browser:'chrome'}

		browserify(require.resolve('../' + path.basename(moduleName)), {debug: true}).ignore('browserify').ignore('tape-run').ignore('path').bundle().pipe(run(settings)).on('results', (results) => {
			if (!results.ok) {
				process.exit(1);
			}
			server.shutdown();
		}).pipe(process.stdout);
		return server;
	} else {
		testFunction();
	}
};
