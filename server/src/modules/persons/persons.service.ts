import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreatePersonDto } from './dto/create-person.dto';
import { PersonDocument, Person } from '~/src/models/person.model';
import { excl } from '~/src/helpers/dbHelpers';

@Injectable()
export class PersonsService {
  constructor(@InjectModel('Person') private readonly model: Model<Person>) {}

  async getPersons(searchParam: string): Promise<Person[]> {
    try {
      if (!searchParam) {
        return await this.model.find({}, excl).exec();
      } else {
        return await this.model.find({ name: { $regex: searchParam, $options: 'i' } }, excl).exec();
      }
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async createPerson(createPersonDto: CreatePersonDto): Promise<number> {
    let newestPerson: PersonDocument[];
    let personId = 1;

    try {
      newestPerson = await this.model.find().sort({ personId: -1 }).limit(1).exec();
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }

    // If it's not the first person to be created, get the highest person id in the DB and increment it
    if (newestPerson.length === 1) {
      personId = newestPerson[0].personId + 1;
    }

    try {
      const newPerson = new this.model({ personId, ...createPersonDto });
      await newPerson.save();
      return personId;
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }
  }
}