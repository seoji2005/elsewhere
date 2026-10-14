export interface Job {
  id: string; name: string; placeId: string; employerId: string;
  fromMinute: number; toMinute: number; durationMinutes: number; hourlyWage: number;
}

// The overnight tea counter lets a new player earn immediately at the default clock speed.
export const jobs: readonly Job[] = [
  { id: 'tea-helper', name: '잔물결 찻방 돕기', placeId: 'cafe', employerId: 'cafe',
    fromMinute: 0, toMinute: 1440, durationMinutes: 60, hourlyWage: 30 },
  { id: 'exchange-helper', name: '모아결 물건 정리', placeId: 'shop', employerId: 'shop',
    fromMinute: 480, toMinute: 1200, durationMinutes: 120, hourlyWage: 40 },
];
