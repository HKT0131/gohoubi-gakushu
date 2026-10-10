#!/bin/bash
PY=~/venvs/sdgen/bin/python
mkdir -p out/final_bg
$PY bg.py t2i room_morning 201,202,203,204,205,206
$PY bg.py t2i library 211,212,213,214
$PY bg.py t2i cafe 221,222,223,224
echo ALLDONE
