import fs from 'fs';
import path from 'path';

export function createStore(dataDir) {
  const file = path.join(dataDir, 'letters.json');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${JSON.stringify({ letters: {} }, null, 2)}\n`);
  }

  let queue = Promise.resolve();

  function read() {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function update(mutator) {
    const run = queue.then(() => {
      const data = read();
      const result = mutator(data);
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    uploadDir,
    create(letter) {
      return update((data) => {
        data.letters[letter.id] = letter;
        return letter;
      });
    },
    get(id) {
      const data = read();
      return data.letters[id] || null;
    },
  };
}
