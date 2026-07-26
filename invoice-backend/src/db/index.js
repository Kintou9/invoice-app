const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// Test the connection on startup so we get clear feedback
pool.connect()
  .then((client) => {
    console.log('PostgreSQL connected successfully');
    client.release();
  })
  .catch((err) => {
    console.error('PostgreSQL connection FAILED:', err.message);
    console.error('Check DB_HOST, DB_USER, DB_PASSWORD, DB_SSL in your .env');
  });

const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
