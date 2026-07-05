import {alaskaProcessor} from 'src/processors/airline-alaska';
import {americanProcessor} from 'src/processors/airline-american';
import {deltaProcessor} from 'src/processors/airline-delta';
import {southwestProcessor} from 'src/processors/airline-southwest';
import {unitedProcessor} from 'src/processors/airline-united';
import {amazonProcessor} from 'src/processors/amazon';
import {appleEmailProcessor} from 'src/processors/apple';
import {bookingProcessor} from 'src/processors/booking';
import {capitalOneFlightsProcessor} from 'src/processors/capital-one-flights';
import {chaseFlightsProcessor} from 'src/processors/chase-flights';
import {cloudflareProcessor} from 'src/processors/cloudflare';
import {lyftBikeProcessor} from 'src/processors/lyft-bike';
import {lyftRideProcessor} from 'src/processors/lyft-ride';
import {steamEmailProcessor} from 'src/processors/steam';
import {uberRideProcessor} from 'src/processors/uber-ride';

import type {EmailProcessor} from './types';

export const DEFAULT_EMAIL_PROCESSORS: EmailProcessor[] = [
  // Airlines
  alaskaProcessor,
  americanProcessor,
  deltaProcessor,
  southwestProcessor,
  unitedProcessor,
  chaseFlightsProcessor,
  capitalOneFlightsProcessor,
  // Other processors
  amazonProcessor,
  bookingProcessor,
  lyftBikeProcessor,
  lyftRideProcessor,
  appleEmailProcessor,
  cloudflareProcessor,
  steamEmailProcessor,
  uberRideProcessor,
];
