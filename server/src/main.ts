import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const PORT = process.env.PORT || 4000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  let corsOptions;

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) throw new Error('JWT SECRET NOT SET!');
    else if (!process.env.MONGODB_URI) throw new Error('MONGO DB URI NOT SET!');

    corsOptions = {
      origin: ['https://denimintsaev.com', 'https://www.denimintsaev.com', 'https://cubingcontests.denimintsaev.com'],
    };

    console.log('Setting CORS origin policy for ', corsOptions.origin);
  }

  app.enableCors(corsOptions);
  app.setGlobalPrefix('api'); // add global /api prefix to all routes

  await app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));
}

bootstrap();
