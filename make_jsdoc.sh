#!/bin/bash

if [ ! -f jsdoc_toolkit-2.4.0.zip ]; then
    wget http://jsdoc-toolkit.googlecode.com/files/jsdoc_toolkit-2.4.0.zip
fi

if [ ! -d jsdoc_toolkit-2.4.0/jsdoc-toolkit ]; then
    unzip jsdoc_toolkit-2.4.0.zip
fi

cd jsdoc_toolkit-2.4.0/jsdoc-toolkit
bash jsrun.sh -t=templates/jsdoc/ -d=../../jsdoc ../../src/gpgl.js

