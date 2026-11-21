// Unit tests never touch a database; modules that import db.ts only need the variable to exist.
process.env.DATABASE_URL ??= 'postgres://unit-tests@127.0.0.1:1/none';
