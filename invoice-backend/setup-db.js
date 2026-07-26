require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL } = process.env;

const sslConfig = DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

async function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans); }));
}

async function createDatabase() {
  // Connect to the default 'postgres' database to create our db
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: 'postgres',
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: sslConfig,
  });

  await client.connect();
  console.log('Connected to Azure PostgreSQL.');

  const { rows } = await client.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]
  );

  if (rows.length > 0) {
    console.log(`Database "${DB_NAME}" already exists — skipping creation.`);
  } else {
    await client.query(`CREATE DATABASE "${DB_NAME}"`);
    console.log(`Database "${DB_NAME}" created.`);
  }

  await client.end();
}

async function runSchema() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: sslConfig,
  });

  await client.connect();

  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'manager', 'technician')),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoice_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      blob_url TEXT NOT NULL,
      prompt_text TEXT,
      is_active BOOLEAN DEFAULT true,
      uploaded_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      claim_number VARCHAR(100) UNIQUE NOT NULL,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      assigned_to UUID REFERENCES users(id),
      created_by UUID REFERENCES users(id),
      status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'pending_approval', 'approved', 'rejected')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
      template_id UUID REFERENCES invoice_templates(id),
      technician_id UUID REFERENCES users(id),
      model_number VARCHAR(255),
      serial_number VARCHAR(255),
      issue_description TEXT,
      ai_generated_description TEXT,
      filled_blob_url TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
      manager_notes TEXT,
      reviewed_by UUID REFERENCES users(id),
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoice_photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
      blob_url TEXT NOT NULL,
      extracted_model VARCHAR(255),
      extracted_serial VARCHAR(255),
      raw_ai_response TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS parts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
      name VARCHAR(500) NOT NULL,
      part_number VARCHAR(255),
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS part_supplier_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
      supplier_name VARCHAR(255),
      url TEXT NOT NULL,
      price_note VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS supplier_sites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      base_url TEXT NOT NULL,
      logo_url TEXT,
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type VARCHAR(100) NOT NULL,
      entity_id UUID NOT NULL,
      action VARCHAR(100) NOT NULL,
      performed_by UUID REFERENCES users(id),
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_claims_assigned_to ON claims(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_claim_id ON invoices(claim_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_technician_id ON invoices(technician_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_parts_invoice_id ON parts(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
  `;

  await client.query(schema);
  console.log('Schema created successfully.');
  await client.end();
}

async function createAdminUser() {
  const create = await ask('\nCreate your first admin user? (y/n): ');
  if (create.toLowerCase() !== 'y') return;

  const name = await ask('Name: ');
  const email = await ask('Email: ');
  const password = await ask('Password: ');

  const hash = await bcrypt.hash(password, 12);

  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: sslConfig,
  });

  await client.connect();

  const { rows } = await client.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING
     RETURNING id, name, email, role`,
    [name, email, hash]
  );

  if (rows[0]) {
    console.log(`\nAdmin user created: ${rows[0].email}`);
  } else {
    console.log('\nUser with that email already exists — skipped.');
  }

  await client.end();
}

async function main() {
  console.log(`\nConnecting to: ${DB_HOST}/${DB_NAME} as ${DB_USER}\n`);
  try {
    await createDatabase();
    await runSchema();
    await createAdminUser();
    console.log('\nSetup complete. You can now run: npm run dev\n');
  } catch (err) {
    console.error('\nSetup failed:', err.message);
    process.exit(1);
  }
}

main();
