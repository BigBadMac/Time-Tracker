-- The tally for every test file run before it.
\o
select count(*) filter (where ok) || '/' || count(*) || ' passed' as rls from tests.results;
select n, label from tests.results where not ok order by n;
