import { IsString, MaxLength } from 'class-validator';

/**
 * The uploaded spreadsheet, as text.
 *
 * Parsed on the server rather than in the browser so that one set of rules
 * decides what a valid row is. Parsing on the client would mean the API had to
 * re-check everything anyway, and the two checks would disagree the first time
 * either was edited.
 */
export class ImportCsvDto {
  @IsString()
  @MaxLength(2_000_000)
  csv!: string;
}
