import sharp from 'sharp';

// Static files also work on server-rendered pages, without a runtime image request.
await Promise.all([
  [32, 'favicon-32.png'],
  [180, 'apple-touch-icon.png'],
].map(([size, name]) => sharp('public/no-circles-logo.png')
  .resize(size, size).png().toFile(`public/${name}`)));
