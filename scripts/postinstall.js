// import fs from "node:fs/promises";

// async function copyFolder(source, destination) {
//   // Check if source exists
//   if (!(await fs.exists(source))) {
//     throw new Error(`Source folder "${source}" does not exist.`);
//   }

//   // Create the destination directory if it doesn't exist
//   await fs.mkdir(destination, { recursive: true });

//   const entries = await fs.readdir(source);

//   for (const entry of entries) {
//     const sourcePath = `${source}/${entry}`;
//     const destPath = `${destination}/${entry}`;

//     const stats = await fs.stat(sourcePath);

//     if (stats.isDirectory()) {
//       // Recursively call copyFolder for subdirectories
//       await copyFolder(sourcePath, destPath);
//     } else {
//       // Copy the file
//       await fs.copyFile(sourcePath, destPath);
//     }
//   }
// }

// const [src, dest] = process.argv.slice(2);

// if (!src || !dest) {
//   throw new Error("Please provide source and destination paths.");
// }

// const now = performance.now();
// copyFolder(src, dest)
//   .catch((err) => {
//     console.error(err);
//     process.exit(1);
//   })
//   .then(() => {
//     console.log(
//       "Folder copied successfully in",
//       Math.floor(performance.now() - now),
//       "ms."
//     );
//   });
