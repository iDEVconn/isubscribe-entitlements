import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.ts',
    'nest/index': 'src/nest/index.ts',
    'adapters/persistence/memory': 'src/adapters/persistence/memory.ts',
    'adapters/persistence/prisma': 'src/adapters/persistence/prisma.ts',
    'adapters/persistence/supabase': 'src/adapters/persistence/supabase.ts',
    'adapters/persistence/typeorm': 'src/adapters/persistence/typeorm.ts'
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@nestjs/common',
    '@nestjs/core',
    'reflect-metadata',
    'rxjs',
    '@prisma/client',
    '@supabase/supabase-js',
    'typeorm'
  ],
  tsconfig: './tsconfig.build.json'
});
