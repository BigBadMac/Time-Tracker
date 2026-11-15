#!/bin/bash
# Build a fresh local database and run the RLS tests. Needs the local
# Postgres 16 on /tmp:54329 (see HANDOVER, "Container resets").
set -e
cd "$(dirname "$0")"
P="psql -h /tmp -p 54329 -U postgres"
$P -q -c "drop database if exists ttdb;" -c "create database ttdb;" >/dev/null 2>&1
$P -d ttdb -v ON_ERROR_STOP=1 -q -f 00_local_shim.sql -f 01_schema.sql -f 04_personal.sql
$P -d ttdb -v ON_ERROR_STOP=1 -q -t -A -f 02_tests.sql -f 05_personal_tests.sql -f 99_report.sql
