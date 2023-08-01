import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { find } from 'geo-tz';
import { getTimezone } from 'countries-and-timezones';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import { UpdateCompetitionDto } from './dto/update-competition.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CompetitionEvent, CompetitionDocument } from '~/src/models/competition.model';
import { excl } from '~/src/helpers/dbHelpers';
import { RoundDocument } from '~/src/models/round.model';
import { ResultDocument } from '~/src/models/result.model';
import { ResultsService } from '@m/results/results.service';
import { EventsService } from '@m/events/events.service';
import { RecordTypesService } from '@m/record-types/record-types.service';
import { PersonsService } from '@m/persons/persons.service';
import {
  ICompetitionEvent,
  ICompetitionData,
  ICompetitionModData,
  IRound,
  IResult,
  IRecordType,
  ICompetition,
} from '@sh/interfaces';
import { setNewRecords } from '@sh/sharedFunctions';
import C from '@sh/constants';
import { CompetitionState, CompetitionType, WcaRecordType } from '@sh/enums';
import { Role } from '~/src/helpers/enums';

interface ICompetitionUpdateResult {
  events: ICompetitionEvent[];
  participants: number;
}

const eventPopulateOptions = {
  event: { path: 'events.event', model: 'Event' },
  rounds: {
    path: 'events.rounds',
    model: 'Round',
    populate: [
      {
        path: 'results',
        model: 'Result',
      },
    ],
  },
};

@Injectable()
export class CompetitionsService {
  constructor(
    private eventsService: EventsService,
    private resultsService: ResultsService,
    private recordTypesService: RecordTypesService,
    private personsService: PersonsService,
    @InjectModel('Competition') private readonly competitionModel: Model<CompetitionDocument>,
    @InjectModel('Round') private readonly roundModel: Model<RoundDocument>,
    @InjectModel('Result') private readonly resultModel: Model<ResultDocument>,
  ) {}

  async getCompetitions(region?: string): Promise<CompetitionDocument[]> {
    const queryFilter: any = region ? { countryId: region } : {};
    queryFilter.state = { $gt: CompetitionState.Created };

    try {
      const competitions = await this.competitionModel
        .find(queryFilter, {
          ...excl,
          createdBy: 0,
        })
        .sort({ startDate: -1 })
        .exec();

      return competitions;
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async getModCompetitions(userId: number, roles: Role[]): Promise<ICompetition[]> {
    try {
      if (roles.includes(Role.Admin)) {
        return await this.competitionModel.find({}, excl).sort({ startDate: -1 }).exec();
      } else {
        return await this.competitionModel
          .find(
            { createdBy: userId },
            {
              ...excl,
              createdBy: 0,
            },
          )
          .sort({ startDate: -1 })
          .exec();
      }
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async getCompetition(competitionId: string): Promise<ICompetitionData> {
    const competition = await this.getFullCompetition(competitionId);

    if (competition?.state > CompetitionState.Created) {
      const output: ICompetitionData = {
        competition,
        persons: [],
        timezoneOffset: getTimezone(find(competition.latitude, competition.longitude)[0]).dstOffset,
      };

      // Get information about all participants and events of the competition if the results have been posted
      try {
        if (competition.state >= CompetitionState.Ongoing) {
          const personIds: number[] = this.getCompetitionParticipants(competition.events);
          output.persons = await this.personsService.getPersonsById(personIds);
        }
      } catch (err) {
        throw new InternalServerErrorException(err.message);
      }

      return output;
    }

    throw new NotFoundException(`Competition with id ${competitionId} not found`);
  }

  async getModCompetition(competitionId: string): Promise<ICompetitionModData> {
    const competition = await this.getFullCompetition(competitionId);
    const personIds: number[] = this.getCompetitionParticipants(competition.events);

    if (competition) {
      const compModData: ICompetitionModData = {
        competition,
        persons: await this.personsService.getPersonsById(personIds),
        // This is DIFFERENT from the output of getEventRecords(), because this holds records for ALL events
        records: {} as any,
      };
      const activeRecordTypes = await this.recordTypesService.getRecordTypes({ active: true });

      // Get current records for this competition's events
      for (const compEvent of competition.events) {
        compModData.records[compEvent.event.eventId] = await this.getEventRecords(
          compEvent.event.eventId,
          activeRecordTypes,
          new Date(competition.startDate),
        );
      }

      return compModData;
    }

    throw new NotFoundException(`Competition with id ${competitionId} not found`);
  }

  // Create new competition, if one with that id doesn't already exist (no results yet)
  async createCompetition(createCompetitionDto: CreateCompetitionDto, creatorPersonId: number) {
    let comp;
    try {
      comp = await this.competitionModel.findOne({ competitionId: createCompetitionDto.competitionId }).exec();
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }

    if (comp) throw new BadRequestException(`Competition with id ${createCompetitionDto.competitionId} already exists`);

    try {
      // First save all of the rounds in the DB (without any results until they get posted)
      const competitionEvents: CompetitionEvent[] = [];

      for (const compEvent of createCompetitionDto.events) {
        competitionEvents.push(await this.getNewCompetitionEvent(compEvent));
      }

      // Create new competition
      const newCompetition = {
        ...createCompetitionDto,
        events: competitionEvents,
        createdBy: creatorPersonId,
        state: CompetitionState.Created,
        participants: 0,
      };

      if (createCompetitionDto.organizers) {
        newCompetition.organizers = await this.personsService.getPersonsById(
          createCompetitionDto.organizers.map((org) => org.personId),
        );
      }

      await this.competitionModel.create(newCompetition);
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async updateCompetition(competitionId: string, updateCompetitionDto: UpdateCompetitionDto, roles: Role[]) {
    const comp = await this.findCompetition(competitionId, true);

    // Validation
    if (updateCompetitionDto.events.some((ev) => ev.rounds.length > C.maxRounds))
      throw new BadRequestException(`You cannot have an event with more than ${C.maxRounds} rounds`);
    if (updateCompetitionDto.events.some((el) => el.rounds.length === 0))
      throw new BadRequestException('You cannot have an event with no rounds');

    // Competition-only validation
    if (comp.type === CompetitionType.Competition) {
      if (!updateCompetitionDto.endDate) throw new BadRequestException('Please enter an end date');
    }

    const isAdmin = roles.includes(Role.Admin);

    // Only an admin is allowed to edit these fields
    if (isAdmin) {
      comp.competitionId = updateCompetitionDto.competitionId;
      comp.countryId = updateCompetitionDto.countryId;
    }

    if (isAdmin || comp.state < CompetitionState.Finished) {
      if (updateCompetitionDto.contact) comp.contact = updateCompetitionDto.contact;
      if (updateCompetitionDto.description) comp.description = updateCompetitionDto.description;

      comp.events = await this.updateCompetitionEvents(comp.events, updateCompetitionDto.events);
    }

    if (isAdmin || comp.state < CompetitionState.Ongoing) {
      comp.name = updateCompetitionDto.name;
      comp.city = updateCompetitionDto.city;
      comp.venue = updateCompetitionDto.venue;
      if (updateCompetitionDto.address) comp.address = updateCompetitionDto.address;
      if (updateCompetitionDto.latitude && updateCompetitionDto.longitude) {
        comp.latitude = updateCompetitionDto.latitude;
        comp.longitude = updateCompetitionDto.longitude;
      }
      comp.startDate = updateCompetitionDto.startDate;
      if (updateCompetitionDto.endDate) comp.endDate = updateCompetitionDto.endDate;
      if (updateCompetitionDto.organizers) {
        comp.organizers = await this.personsService.getPersonsById(
          updateCompetitionDto.organizers.map((org) => org.personId),
        );
      }
      if (updateCompetitionDto.competitorLimit) comp.competitorLimit = updateCompetitionDto.competitorLimit;
      comp.mainEventId = updateCompetitionDto.mainEventId;
    }

    await this.saveCompetition(comp);
  }

  async updateState(competitionId: string, newState: CompetitionState, roles: Role[]) {
    const comp = await this.findCompetition(competitionId);

    if (
      roles.includes(Role.Admin) ||
      // Allow mods only to finish an ongoing competition
      (newState === CompetitionState.Finished && comp.state === CompetitionState.Ongoing)
    ) {
      comp.state = newState;

      if (newState === CompetitionState.Published) {
        console.log(`Publishing competition ${comp.competitionId}`);

        try {
          await this.roundModel.updateMany({ competitionId: comp.competitionId }, { $unset: { compNotPublished: '' } });
          await this.resultModel.updateMany(
            { competitionId: comp.competitionId },
            { $unset: { compNotPublished: '' } },
          );
        } catch (err) {
          throw new InternalServerErrorException(`Error while publishing competition: ${err.message}`);
        }
      }
    }

    await this.saveCompetition(comp);
  }

  async postResults(competitionId: string, updateCompetitionDto: UpdateCompetitionDto) {
    const comp = await this.findCompetition(competitionId);

    if (comp.state < CompetitionState.Approved) {
      throw new BadRequestException("You may not post the results for a competition that hasn't been approved");
    } else if (comp.state >= CompetitionState.Finished) {
      throw new BadRequestException('You may not post the results for a finished competition');
    }

    // Store the results temporarily in case there is an error
    let tempResults: IResult[];

    try {
      tempResults = (await this.resultModel.find({ competitionId }).exec()) as IResult[];
      await this.resultModel.deleteMany({ competitionId }).exec();

      const activeRecordTypes = await this.recordTypesService.getRecordTypes({ active: true });

      comp.participants = (
        await this.updateCompetitionResults(updateCompetitionDto.events, activeRecordTypes)
      ).participants;
      comp.state = CompetitionState.Ongoing;
    } catch (err) {
      // Reset the results if there was an error while posting the results
      if (tempResults?.length > 0) {
        await this.resultModel.deleteMany({ competitionId }).exec();
        await this.resultModel.create(tempResults);
      }

      throw new InternalServerErrorException(`Error while updating competition events: ${err.message}`);
    }

    await this.saveCompetition(comp);
  }

  /////////////////////////////////////////////////////////////////////////////////////
  // HELPERS
  /////////////////////////////////////////////////////////////////////////////////////

  private async findCompetition(competitionId: string, populateEvents = false): Promise<CompetitionDocument> {
    let competition: CompetitionDocument;

    try {
      if (!populateEvents) {
        competition = await this.competitionModel.findOne({ competitionId }).exec();
      } else {
        competition = await this.competitionModel
          .findOne({ competitionId })
          .populate(eventPopulateOptions.event)
          .populate(eventPopulateOptions.rounds)
          .exec();
      }
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }

    if (!competition) throw new NotFoundException(`Competition with id ${competitionId} not found`);

    return competition;
  }

  private async saveCompetition(competition: CompetitionDocument) {
    try {
      await competition.save();
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }
  }

  // Finds the competition with the given competition id with the rounds and results populated
  private async getFullCompetition(competitionId: string): Promise<CompetitionDocument> {
    try {
      return await this.competitionModel
        .findOne(
          { competitionId },
          {
            ...excl,
            createdBy: 0,
          },
        )
        .populate(eventPopulateOptions.event)
        .populate(eventPopulateOptions.rounds)
        .populate({ path: 'organizers', model: 'Person' })
        .exec();
    } catch (err) {
      throw new NotFoundException(err.message);
    }
  }

  private async getNewCompetitionEvent(compEvent: ICompetitionEvent): Promise<CompetitionEvent> {
    const eventRounds: RoundDocument[] = [];

    for (const round of compEvent.rounds) eventRounds.push(await this.roundModel.create(round));

    return {
      event: await this.eventsService.getEventById(compEvent.event.eventId),
      rounds: eventRounds,
    };
  }

  // This method must only be called when the event rounds have been populated
  private getCompetitionParticipants(events: ICompetitionEvent[]): number[] {
    const personIds: number[] = [];
    for (const event of events) {
      for (const round of event.rounds) this.getParticipantsInRound(round, personIds);
    }
    return personIds;
  }

  // Adds new unique participants to the personIds array
  private getParticipantsInRound(round: IRound, personIds: number[]): void {
    for (const result of round.results) {
      // personId can have multiple ids separated by ; so all ids need to be checked
      for (const personId of result.personId.split(';').map((el) => parseInt(el))) {
        if (!personIds.includes(personId)) {
          personIds.push(personId);
        }
      }
    }
  }

  private async updateCompetitionEvents(
    compEvents: CompetitionEvent[],
    newEvents: ICompetitionEvent[],
  ): Promise<CompetitionEvent[]> {
    // Remove deleted rounds and events
    for (const compEvent of compEvents) {
      const sameEventInNew = newEvents.find((el) => el.event.eventId === compEvent.event.eventId);

      if (sameEventInNew) {
        for (const round of compEvent.rounds) {
          if (!sameEventInNew.rounds.some((el) => el._id === round._id.toString())) {
            // Delete round if it has no results
            if (round.results.length === 0) {
              await this.roundModel.deleteOne({ _id: round._id });
              compEvent.rounds = compEvent.rounds.filter((el) => el !== round);
            }
          }
        }
      }
      // Delete event and all of its rounds if it has no results
      else if (!compEvent.rounds.some((el) => el.results.length > 0)) {
        await this.roundModel.deleteMany({ _id: { $in: compEvent.rounds.map((el) => el._id) } });
        compEvents = compEvents.filter((el) => el.event.eventId !== compEvent.event.eventId);
      }
    }

    // Update rounds and add new events
    for (const newEvent of newEvents) {
      const sameEventInComp = compEvents.find((el) => el.event.eventId === newEvent.event.eventId);

      if (sameEventInComp) {
        for (const round of newEvent.rounds) {
          const sameRoundInComp = sameEventInComp.rounds.find((el) => el._id.toString() === round._id);

          if (sameRoundInComp) {
            // Update round
            const updateObj: any = { $set: { roundTypeId: round.roundTypeId } };

            if (sameRoundInComp.results.length === 0) updateObj.$set.format = round.format;

            // Update proceed object if the updated round has it and the round has no results
            // or set it, if the round previously had no proceed object (meaning it was the final round)
            if (round.proceed) {
              if (sameRoundInComp.results.length === 0 || !sameRoundInComp.proceed)
                updateObj.$set.proceed = round.proceed;
            } else if (sameRoundInComp.proceed) {
              // Unset proceed object if it got deleted (the round became the final round due to a deletion)
              updateObj.$unset = { proceed: '' };
            }

            await this.roundModel.updateOne({ _id: round._id }, updateObj).exec();
          } else {
            // Add new round
            sameEventInComp.rounds.push(await this.roundModel.create(round));
          }
        }
      } else {
        compEvents.push(await this.getNewCompetitionEvent(newEvent));
      }
    }

    compEvents.sort((a, b) => a.event.rank - b.event.rank);

    return compEvents;
  }

  // Assumes that all records in newCompEvents have been reset (because they need to be set from scratch)
  async updateCompetitionResults(
    newCompEvents: ICompetitionEvent[],
    activeRecordTypes: IRecordType[],
  ): Promise<ICompetitionUpdateResult> {
    // output.events is for automated tests
    const output: ICompetitionUpdateResult = { participants: 0, events: [] };
    const personIds: number[] = []; // used for calculating the number of participants

    // Save all results from every event and set new records, if there are any
    for (const compEvent of newCompEvents) {
      const eventRounds: IRound[] = [];
      let sameDayRounds: IRound[] = [];
      // These are set to null if there are no active record types
      const records: any = await this.getEventRecords(compEvent.event.eventId, activeRecordTypes);
      compEvent.rounds.sort((a: IRound, b: IRound) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const round of compEvent.rounds) {
        // Set the records from the last day, when the day changes
        if (sameDayRounds.length > 0 && round.date !== sameDayRounds[0].date) {
          eventRounds.push(...(await this.setRecordsAndSaveResults(sameDayRounds, activeRecordTypes, records)));
          sameDayRounds = [];
        }
        sameDayRounds.push(round);

        this.getParticipantsInRound(round, personIds);
      }

      // Set the records for the last day of rounds
      eventRounds.push(...(await this.setRecordsAndSaveResults(sameDayRounds, activeRecordTypes, records)));
      output.events.push({ ...compEvent, rounds: eventRounds });
    }

    output.participants = personIds.length;
    return output;
  }

  async getEventRecords(
    eventId: string,
    activeRecordTypes: IRecordType[],
    beforeDate: Date = null, // max date as default
  ) {
    // Returns null if no record types are active
    if (activeRecordTypes.length === 0) return null;

    // If a date wasn't passed, use max date, otherwise use the passed date at midnight to compare just the dates
    if (!beforeDate) beforeDate = new Date(8640000000000000);
    else
      beforeDate = new Date(Date.UTC(beforeDate.getUTCFullYear(), beforeDate.getUTCMonth(), beforeDate.getUTCDate()));

    const records: any = {};

    // Go through all active record types
    for (const rt of activeRecordTypes) {
      const newRecords = { best: -1, average: -1 };

      const singleResults = await this.resultsService.getEventSingleRecordResults(eventId, rt.label, beforeDate);
      if (singleResults.length > 0) newRecords.best = singleResults[0].best;

      const avgResults = await this.resultsService.getEventAverageRecordResults(eventId, rt.label, beforeDate);
      if (avgResults.length > 0) newRecords.average = avgResults[0].average;

      records[rt.wcaEquivalent] = newRecords;
    }

    return records;
  }

  // Sets the newly-set records in sameDayRounds using the information from records
  // (but only the active record types) and returns the rounds
  async setRecordsAndSaveResults(
    sameDayRounds: IRound[],
    activeRecordTypes: IRecordType[],
    records: any,
  ): Promise<IRound[]> {
    // Set records
    for (const rt of activeRecordTypes) {
      // TO-DO: REMOVE HARD CODING TO WR!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      if (rt.active && rt.wcaEquivalent === WcaRecordType.WR) {
        sameDayRounds = setNewRecords(sameDayRounds, records[rt.wcaEquivalent], rt.label, true);
      }
    }

    // Save results in the DB
    try {
      for (const round of sameDayRounds) {
        const newResults = await this.resultModel.create(round.results);

        await this.roundModel.updateOne({ _id: round._id }, { $set: { results: newResults } }).exec();
      }
    } catch (err) {
      throw new Error(`Error while creating rounds: ${err.message}`);
    }

    return sameDayRounds;
  }
}
