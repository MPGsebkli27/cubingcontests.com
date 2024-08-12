import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsUrl,
  Validate,
  ValidateNested,
} from 'class-validator';
import { DATE_VALIDATION_MSG, DISCUSSION_LINK_VALIDATION_MSG, VIDEO_LINK_VALIDATION_MSG } from '~/src/helpers/messages';
import { AttemptDto, HasNonDnsResult } from './create-result.dto';
import { IAttempt, IUpdateResultDto } from '@sh/types';

export class UpdateResultDto implements IUpdateResultDto {
  @IsDateString({}, { message: DATE_VALIDATION_MSG })
  date: Date;

  @IsOptional()
  @IsBoolean()
  unapproved?: boolean;

  @ArrayMinSize(1)
  @IsInt({ each: true })
  personIds: number[];

  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @Validate(HasNonDnsResult)
  @ValidateNested({ each: true })
  @Type(() => AttemptDto)
  attempts: IAttempt[];

  @IsOptional()
  @IsUrl({}, { message: VIDEO_LINK_VALIDATION_MSG })
  videoLink?: string;

  @IsOptional()
  @IsUrl({}, { message: DISCUSSION_LINK_VALIDATION_MSG })
  discussionLink?: string;
}