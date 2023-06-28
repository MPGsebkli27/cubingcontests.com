import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// THIS IS A TEMPORARY ADDITION FOR BUGFIXING!!!
console.log('Env:', process.env.MONGODB_URI, process.env.NODE_ENV, process.env.PORT);

const PORT = process.env.PORT || 4000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  let corsOptions;

  if (process.env.NODE_ENV === 'production') {
    corsOptions = {
      origin: ['https://denimintsaev.com', 'https://www.denimintsaev.com', 'https://cubingcontests.denimintsaev.com'],
    };

    console.log('Setting CORS origin policy for ', corsOptions.origin);
  }

  app.enableCors(corsOptions);

  await app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));
}
bootstrap();
