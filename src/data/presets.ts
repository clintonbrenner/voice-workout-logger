/**
 * Built-in workouts that appear in "Select workout" on first launch.
 * (Wired into the UI in milestone 3. The plan importer will produce this same shape.)
 */
export interface PlannedExercise {
  name: string;
  muscleGroup?: string;
  sets: number;
  /** For timed exercises (unit 'seconds') these hold seconds instead of reps. */
  repsMin: number;
  repsMax: number;
  /** 'seconds' for holds like a plank or hollow body hold; reps if absent. */
  unit?: 'seconds';
  targetWeightLb?: number;
  restSecMin?: number;
  restSecMax?: number;
  notes?: string;
}

export interface WorkoutDay {
  name: string;
  exercises: PlannedExercise[];
}

export const PRESET_WORKOUTS: WorkoutDay[] = [
  {
    name: 'Arms',
    exercises: [
      { name: 'EZ-Bar Preacher Curl', muscleGroup: 'Biceps', sets: 3, repsMin: 8, repsMax: 12, restSecMin: 90, restSecMax: 90,
        notes: 'Controlled eccentric; get close to full elbow extension without forcing the bottom.' },
      { name: 'Overhead Cable Triceps Extension', muscleGroup: 'Triceps', sets: 3, repsMin: 10, repsMax: 15, restSecMin: 90, restSecMax: 90,
        notes: 'Long head emphasis. Let elbows bend deeply for a good stretch.' },
      { name: 'Incline Dumbbell Curl', muscleGroup: 'Biceps', sets: 3, repsMin: 10, repsMax: 12, restSecMin: 75, restSecMax: 90,
        notes: 'Upper arms behind torso. No swinging or elbows forward.' },
      { name: 'Rope Triceps Pushdown', muscleGroup: 'Triceps', sets: 3, repsMin: 10, repsMax: 15, restSecMin: 75, restSecMax: 90,
        notes: 'Elbows fixed at sides. Extend fully without shoulders.' },
      { name: 'Dumbbell Hammer Curl', muscleGroup: 'Brachialis + Brachioradialis', sets: 3, repsMin: 10, repsMax: 15, restSecMin: 75, restSecMax: 75,
        notes: 'Palms facing inward.' },
      { name: 'Seated Wrist Curl', muscleGroup: 'Forearm Flexors', sets: 2, repsMin: 15, repsMax: 20, restSecMin: 60, restSecMax: 60,
        notes: 'Support forearms; move only at the wrists.' },
      { name: 'Reverse Wrist Curl', muscleGroup: 'Forearm Extensors', sets: 2, repsMin: 15, repsMax: 20, restSecMin: 60, restSecMax: 60,
        notes: 'Palms down, light weight, no momentum.' },
    ],
  },
];
