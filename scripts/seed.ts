// npm run seed — fills the local database with the demo floor. Stop `npm run dev` first: the embedded
// database belongs to one process at a time. Refuses to touch a remote DATABASE_URL.
import { seedDemo } from '../src/seed/demo';

if (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  console.error('Refusing to seed demo data into a remote database.');
  process.exit(1);
}

const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 30);
seedDemo({ days, log: (m) => console.log(m) })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
