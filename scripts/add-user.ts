import 'dotenv/config';
import { UserStore } from '../src/core/auth.js';
import { createStorageBackend } from '../src/core/storage/index.js';

const email = process.argv[2];
const name = process.argv[3] ?? '';

if (!email) {
  console.log('Usage: npx tsx scripts/add-user.ts <email> [name]');
  console.log('       npm run add-user -- <email> [name]');
  process.exit(1);
}

async function main() {
  const storage = await createStorageBackend();
  await storage.initialize('');
  const store = new UserStore(storage);

  const user = await store.findByEmail(email);
  if (user) {
    console.log(`User already exists: ${user.email} (${user.name || 'no name'})`);
    process.exit(0);
  }

  const added = await store.addUser(email, name);
  console.log(`Added user: ${added.email}${added.name ? ` (${added.name})` : ''}`);
}

main().catch((err) => {
  console.error('Failed to add user:', err.message);
  process.exit(1);
});
