
const DEFAULT_SECONDS_TO_WAIT = 10;

module.exports = waitFor;

function waitFor(assertion, secondsToWait = DEFAULT_SECONDS_TO_WAIT) {
	return new Promise((resolve, reject) => {
		let counter = 0;
		let handle = setInterval(() => {
			if (assertion()) {
				resolve();
				clearInterval(handle);
			} else if (counter++ >= secondsToWait) {
				reject();
				clearInterval(handle);
			}
		}, 1000);
	});
}
