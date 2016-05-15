#!/bin/bash
:>| failure.hammer.log
:>| success.hammer.log
counter=0
for i in `seq 1 $1`;
do
	node ../test/dht.int.test.js &>singlerun.log
	if [ $? -eq 0 ]
	then
		cat singlerun.log >> success.hammer.log
		echo "Successfully ran test"
	else
		counter=$[counter + 1]
		cat singlerun.log >> failure.hammer.log
		echo "Test run failed"
	fi
done

echo "Failures: $counter of $1"
