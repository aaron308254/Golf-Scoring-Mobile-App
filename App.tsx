import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type AppScreen =
  | "home"
  | "scorecardForm"
  | "scorecardEditor"
  | "scorecardView"
  | "profileForm"
  | "profileDetail";

type HomeSection = "scorecards" | "profiles";
type ViewSource = "home" | "profile";
type Difficulty = "1" | "2" | "3" | "4";
type HolesPlayed = 9 | 18;
type TeeOption = "Front" | "Middle" | "Back";

type ScorecardFormState = {
  courseName: string;
  difficulty: Difficulty | "";
  holesPlayed: `${HolesPlayed}` | "";
  date: string;
  tees: TeeOption | "";
};

type HoleDraft = {
  par: string;
  yardage: string;
};

type PlayerRowDraft = {
  profileId: string | null;
  scores: string[];
};

type ScorecardDraft = {
  meta: ScorecardFormState;
  holes: HoleDraft[];
  playerRows: PlayerRowDraft[];
};

type ScorecardRecord = {
  id: string;
  courseName: string;
  difficulty: Difficulty | "";
  holesPlayed: HolesPlayed;
  date: string;
  tees: TeeOption | "";
  holes: HoleDraft[];
  playerRows: PlayerRowDraft[];
  createdAt: string;
};

type ProfileRecord = {
  id: string;
  name: string;
  dateOfBirth: string;
  createdAt: string;
};

type EditorState = {
  draft: ScorecardDraft;
  editingId: string | null;
  returnView: {
    scorecardId: string;
    source: ViewSource;
    profileId: string | null;
  } | null;
};

type ScorecardViewState = {
  scorecardId: string;
  source: ViewSource;
  profileId: string | null;
};

type ProfileFormState = {
  name: string;
  dateOfBirth: string;
  assignToSlot: number | null;
  editingId: string | null;
};

type ProfileRound = {
  scorecard: ScorecardRecord;
  playerRow: PlayerRowDraft;
  holeCount: number;
  totalPar: number;
  totalScore: number;
  overUnder: number;
  normalizedTo18: number;
};

type ScoreTally = {
  holeInOnes: number;
  albatrosses: number;
  eagles: number;
  birdies: number;
  pars: number;
  bogeys: number;
  doubleBogeys: number;
  tripleBogeys: number;
};

type ProfileStats = {
  bestRound: ProfileRound | null;
  worstRound: ProfileRound | null;
  handicap: number | null;
  handicapPer18: number | null;
  handicapTrend: number | null;
  tally: ScoreTally;
};

type PersistedAppData = {
  version: 1;
  scorecards: ScorecardRecord[];
  profiles: ProfileRecord[];
};

const DIFFICULTY_OPTIONS: Difficulty[] = ["1", "2", "3", "4"];
const HOLE_OPTIONS: Array<`${HolesPlayed}`> = ["9", "18"];
const TEE_OPTIONS: TeeOption[] = ["Front", "Middle", "Back"];
const DEFAULT_PLAYER_ROWS = 4;
const CELL_WIDTH = 68;
const LABEL_WIDTH = 162;
const SCORE_MIN = 1;
const SCORE_MAX = 7;
const STORAGE_KEY = "golf-scoring-ios-app:data:v1";

function createEmptyForm(): ScorecardFormState {
  return {
    courseName: "",
    difficulty: "",
    holesPlayed: "",
    date: "",
    tees: "",
  };
}

function createDraftFromForm(form: ScorecardFormState): ScorecardDraft {
  const holeCount = Number(form.holesPlayed || 9) as HolesPlayed;

  return {
    meta: form,
    holes: Array.from({ length: holeCount }, () => ({
      par: "",
      yardage: "",
    })),
    playerRows: Array.from({ length: DEFAULT_PLAYER_ROWS }, () => ({
      profileId: null,
      scores: Array.from({ length: holeCount }, () => ""),
    })),
  };
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildKnownCourseNames(scorecards: ScorecardRecord[]): string[] {
  const names = new Map<string, string>();

  scorecards.forEach((scorecard) => {
    const normalizedName = normalizeName(scorecard.courseName);

    if (!normalizedName || names.has(normalizedName)) {
      return;
    }

    names.set(normalizedName, scorecard.courseName.trim());
  });

  return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
}

function getCourseSuggestions(courseNames: string[], query: string): string[] {
  const normalizedQuery = normalizeName(query);

  return courseNames
    .filter((courseName) => {
      const normalizedCourseName = normalizeName(courseName);

      if (!normalizedQuery) {
        return true;
      }

      return normalizedCourseName.includes(normalizedQuery);
    })
    .slice(0, 5);
}

function findCourseTemplate(
  scorecards: ScorecardRecord[],
  courseName: string,
  holesPlayed: HolesPlayed,
): ScorecardRecord | null {
  const normalizedCourseName = normalizeName(courseName);

  return (
    scorecards.find(
      (scorecard) =>
        normalizeName(scorecard.courseName) === normalizedCourseName &&
        scorecard.holesPlayed === holesPlayed,
    ) ?? null
  );
}

function createDraftWithCourseTemplate(
  form: ScorecardFormState,
  template: ScorecardRecord | null,
): ScorecardDraft {
  const draft = createDraftFromForm(form);

  if (!template) {
    return draft;
  }

  return {
    ...draft,
    holes: draft.holes.map((hole, index) => ({
      par: template.holes[index]?.par ?? hole.par,
      yardage: template.holes[index]?.yardage ?? hole.yardage,
    })),
  };
}

function isPersistedAppData(value: unknown): value is PersistedAppData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedAppData>;

  return candidate.version === 1 && Array.isArray(candidate.scorecards) && Array.isArray(candidate.profiles);
}

function scorecardToDraft(scorecard: ScorecardRecord): ScorecardDraft {
  return {
    meta: {
      courseName: scorecard.courseName,
      difficulty: scorecard.difficulty,
      holesPlayed: `${scorecard.holesPlayed}`,
      date: scorecard.date,
      tees: scorecard.tees,
    },
    holes: scorecard.holes.map((hole) => ({ ...hole })),
    playerRows: scorecard.playerRows.map((playerRow) => ({
      profileId: playerRow.profileId,
      scores: [...playerRow.scores],
    })),
  };
}

function buildScorecardRecord(
  draft: ScorecardDraft,
  editingId: string | null,
  existingCreatedAt: string | null,
): ScorecardRecord {
  return {
    id: editingId ?? createId("scorecard"),
    courseName: draft.meta.courseName.trim(),
    difficulty: draft.meta.difficulty,
    holesPlayed: Number(draft.meta.holesPlayed) as HolesPlayed,
    date: draft.meta.date.trim(),
    tees: draft.meta.tees,
    holes: draft.holes.map((hole) => ({
      par: hole.par.trim(),
      yardage: hole.yardage.trim(),
    })),
    playerRows: draft.playerRows.map((row) => ({
      profileId: row.profileId,
      scores: row.scores.map((score) => score.trim()),
    })),
    createdAt: existingCreatedAt ?? new Date().toISOString(),
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function isValidDateString(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  const parts = value.split("/");

  if (parts.length !== 3) {
    return false;
  }

  const [monthRaw, dayRaw, yearRaw] = parts;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);

  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) {
    return false;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) {
    return false;
  }

  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatSigned(value: number | null, maximumFractionDigits = 0): string {
  if (value === null || Number.isNaN(value)) {
    return "Unknown";
  }

  const rounded = Number(value.toFixed(maximumFractionDigits));

  if (rounded > 0) {
    return `+${rounded}`;
  }

  return `${rounded}`;
}

function calculateAge(dateOfBirth: string): string {
  if (!isValidDateString(dateOfBirth)) {
    return "Unknown";
  }

  const [monthRaw, dayRaw, yearRaw] = dateOfBirth.split("/");
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  const birthDate = new Date(year, month - 1, day);
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age >= 0 ? `${age}` : "Unknown";
}

function getScoreShape(scoreText: string, parText: string): "none" | "circle" | "square" | "doubleSquare" {
  const score = parseNumber(scoreText);
  const par = parseNumber(parText);

  if (score === null || par === null) {
    return "none";
  }

  if (score >= SCORE_MAX) {
    return "doubleSquare";
  }

  const delta = score - par;

  if (delta <= -1) {
    return "circle";
  }

  if (delta === 1) {
    return "square";
  }

  if (delta === 2) {
    return "doubleSquare";
  }

  return "none";
}

function formatTotal(values: string[]): string {
  let total = 0;
  let hasValue = false;

  values.forEach((value) => {
    const parsedValue = parseNumber(value);

    if (parsedValue === null) {
      return;
    }

    total += parsedValue;
    hasValue = true;
  });

  return hasValue ? `${total}` : "-";
}

function formatHoleTotal(holes: HoleDraft[], field: keyof HoleDraft): string {
  return formatTotal(holes.map((hole) => hole[field]));
}

function sanitizePlayerScore(value: string): string {
  const digitsOnly = value.replace(/[^0-9]/g, "");

  if (!digitsOnly) {
    return "";
  }

  const numericValue = Number(digitsOnly);

  if (numericValue < SCORE_MIN) {
    return `${SCORE_MIN}`;
  }

  if (numericValue > SCORE_MAX) {
    return `${SCORE_MAX}`;
  }

  return `${numericValue}`;
}

function buildProfileRounds(scorecards: ScorecardRecord[], profileId: string): ProfileRound[] {
  const rounds: ProfileRound[] = [];

  for (const scorecard of scorecards) {
    for (const playerRow of scorecard.playerRows) {
      if (playerRow.profileId !== profileId) {
        continue;
      }

      let totalPar = 0;
      let totalScore = 0;
      let holeCount = 0;

      scorecard.holes.forEach((hole, index) => {
        const par = parseNumber(hole.par);
        const score = parseNumber(playerRow.scores[index] ?? "");

        if (par === null || score === null) {
          return;
        }

        totalPar += par;
        totalScore += score;
        holeCount += 1;
      });

      if (holeCount === 0) {
        continue;
      }

      const overUnder = totalScore - totalPar;

      rounds.push({
        scorecard,
        playerRow,
        holeCount,
        totalPar,
        totalScore,
        overUnder,
        normalizedTo18: (overUnder / holeCount) * 18,
      });
    }
  }

  return rounds.sort(
    (a, b) => new Date(b.scorecard.createdAt).getTime() - new Date(a.scorecard.createdAt).getTime(),
  );
}

function buildHoleTimeline(scorecards: ScorecardRecord[], profileId: string): Array<{ delta: number }> {
  const entries = scorecards
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const timeline: Array<{ delta: number }> = [];

  for (const scorecard of entries) {
    const playerRow = scorecard.playerRows.find((row) => row.profileId === profileId);

    if (!playerRow) {
      continue;
    }

    scorecard.holes.forEach((hole, index) => {
      const par = parseNumber(hole.par);
      const score = parseNumber(playerRow.scores[index] ?? "");

      if (par === null || score === null) {
        return;
      }

      timeline.push({ delta: score - par });
    });
  }

  return timeline;
}

function calculateHandicapFromTimeline(
  timeline: Array<{ delta: number }>,
  startIndex: number,
  length: number,
): number | null {
  const window = timeline.slice(startIndex, startIndex + length);

  if (window.length < 9) {
    return null;
  }

  const totalDelta = window.reduce((sum, entry) => sum + entry.delta, 0);

  return (totalDelta / window.length) * 9;
}

function buildProfileStats(scorecards: ScorecardRecord[], profileId: string): ProfileStats {
  const rounds = buildProfileRounds(scorecards, profileId);
  const holeTimeline = buildHoleTimeline(scorecards, profileId);

  let bestRound: ProfileRound | null = null;
  let worstRound: ProfileRound | null = null;

  rounds.forEach((round) => {
    if (!bestRound || round.normalizedTo18 < bestRound.normalizedTo18) {
      bestRound = round;
    }

    if (!worstRound || round.normalizedTo18 > worstRound.normalizedTo18) {
      worstRound = round;
    }
  });

  const handicap = calculateHandicapFromTimeline(holeTimeline, 0, 54);
  const previousWindowHandicap = calculateHandicapFromTimeline(holeTimeline, 27, 81);
  const handicapTrend =
    handicap !== null && previousWindowHandicap !== null ? handicap - previousWindowHandicap : null;
  const handicapPer18 = handicap !== null ? handicap * 2 : null;

  const tally: ScoreTally = {
    holeInOnes: 0,
    albatrosses: 0,
    eagles: 0,
    birdies: 0,
    pars: 0,
    bogeys: 0,
    doubleBogeys: 0,
    tripleBogeys: 0,
  };

  holeTimeline.forEach((entry) => {
    if (entry.delta === 0) {
      tally.pars += 1;
    } else if (entry.delta === 1) {
      tally.bogeys += 1;
    } else if (entry.delta === 2) {
      tally.doubleBogeys += 1;
    } else if (entry.delta >= 3) {
      tally.tripleBogeys += 1;
    } else if (entry.delta === -1) {
      tally.birdies += 1;
    } else if (entry.delta === -2) {
      tally.eagles += 1;
    } else if (entry.delta <= -3) {
      tally.albatrosses += 1;
    }
  });

  rounds.forEach((round) => {
    round.playerRow.scores.forEach((scoreText, index) => {
      const score = parseNumber(scoreText);

      if (score === 1) {
        tally.holeInOnes += 1;
      }
    });
  });

  return {
    bestRound,
    worstRound,
    handicap,
    handicapPer18,
    handicapTrend,
    tally,
  };
}

function getScorecardSubtitle(scorecard: ScorecardRecord): string {
  const dateText = scorecard.date.trim() ? scorecard.date.trim() : "Unknown date";
  return `${scorecard.holesPlayed} holes  |  ${dateText}`;
}

function getMetadataValue(value: string): string {
  return value.trim() ? value.trim() : "Unknown";
}

function getScorecardTotalForRow(scorecard: ScorecardRecord, row: PlayerRowDraft): number | null {
  let total = 0;
  let hasValue = false;

  row.scores.forEach((scoreText) => {
    const score = parseNumber(scoreText);

    if (score === null) {
      return;
    }

    total += score;
    hasValue = true;
  });

  return hasValue ? total : null;
}

function getTotalPar(scorecard: ScorecardRecord): number | null {
  let total = 0;

  for (const hole of scorecard.holes) {
    const par = parseNumber(hole.par);

    if (par === null) {
      return null;
    }

    total += par;
  }

  return total;
}

export default function App() {
  const hasLoadedPersistedData = useRef(false);
  const [screen, setScreen] = useState<AppScreen>("home");
  const [homeSection, setHomeSection] = useState<HomeSection>("scorecards");
  const [menuOpen, setMenuOpen] = useState(false);
  const [scorecards, setScorecards] = useState<ScorecardRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [scorecardForm, setScorecardForm] = useState<ScorecardFormState>(createEmptyForm());
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [scorecardViewState, setScorecardViewState] = useState<ScorecardViewState | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    name: "",
    dateOfBirth: "",
    assignToSlot: null,
    editingId: null,
  });
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profilePickerSlot, setProfilePickerSlot] = useState<number | null>(null);

  const viewedScorecard = useMemo(
    () =>
      scorecardViewState
        ? scorecards.find((scorecard) => scorecard.id === scorecardViewState.scorecardId) ?? null
        : null,
    [scorecardViewState, scorecards],
  );
  const viewedProfile = useMemo(
    () => (activeProfileId ? profiles.find((profile) => profile.id === activeProfileId) ?? null : null),
    [activeProfileId, profiles],
  );
  const viewedProfileStats = useMemo(
    () => (activeProfileId ? buildProfileStats(scorecards, activeProfileId) : null),
    [activeProfileId, scorecards],
  );
  const knownCourseNames = useMemo(() => buildKnownCourseNames(scorecards), [scorecards]);

  useEffect(() => {
    let cancelled = false;

    async function loadPersistedData() {
      try {
        const storedValue = await AsyncStorage.getItem(STORAGE_KEY);

        if (!storedValue) {
          return;
        }

        const parsedValue: unknown = JSON.parse(storedValue);

        if (!isPersistedAppData(parsedValue)) {
          return;
        }

        if (cancelled) {
          return;
        }

        setScorecards(parsedValue.scorecards);
        setProfiles(parsedValue.profiles);
      } catch (error) {
        console.error("Unable to load saved golf data", error);
      } finally {
        if (!cancelled) {
          hasLoadedPersistedData.current = true;
        }
      }
    }

    loadPersistedData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedData.current) {
      return;
    }

    const dataToPersist: PersistedAppData = {
      version: 1,
      scorecards,
      profiles,
    };

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dataToPersist)).catch((error) => {
      console.error("Unable to save golf data", error);
    });
  }, [profiles, scorecards]);

  function openHome(nextSection: HomeSection = homeSection) {
    setScreen("home");
    setHomeSection(nextSection);
    setMenuOpen(false);
    setProfilePickerSlot(null);
  }

  function openScorecardForm() {
    setScorecardForm(createEmptyForm());
    setScreen("scorecardForm");
    setMenuOpen(false);
  }

  function openProfileForm(assignToSlot: number | null = null) {
    setProfileForm({
      name: "",
      dateOfBirth: "",
      assignToSlot,
      editingId: null,
    });
    setScreen("profileForm");
    setProfilePickerSlot(null);
  }

  function openProfileEditor(profile: ProfileRecord) {
    setProfileForm({
      name: profile.name,
      dateOfBirth: profile.dateOfBirth,
      assignToSlot: null,
      editingId: profile.id,
    });
    setScreen("profileForm");
    setProfilePickerSlot(null);
  }

  function openScorecardEditorForCreate() {
    const trimmedCourseName = scorecardForm.courseName.trim();

    if (!trimmedCourseName) {
      Alert.alert("Name of course required", "Enter the course name before continuing.");
      return;
    }

    if (!scorecardForm.holesPlayed) {
      Alert.alert("Holes played required", "Choose whether this is a 9-hole or 18-hole round.");
      return;
    }

    if (scorecardForm.date.trim() && !isValidDateString(scorecardForm.date.trim())) {
      Alert.alert("Invalid date", "Use the Month/Day/Year format, such as 05/01/2026.");
      return;
    }

    const holesPlayed = Number(scorecardForm.holesPlayed) as HolesPlayed;
    const normalizedForm = {
      ...scorecardForm,
      courseName: trimmedCourseName,
    };
    const courseTemplate = findCourseTemplate(scorecards, trimmedCourseName, holesPlayed);

    setEditorState({
      draft: createDraftWithCourseTemplate(normalizedForm, courseTemplate),
      editingId: null,
      returnView: null,
    });
    setScreen("scorecardEditor");
  }

  function openScorecardView(
    scorecardId: string,
    source: ViewSource = "home",
    profileId: string | null = null,
  ) {
    setScorecardViewState({
      scorecardId,
      source,
      profileId,
    });
    setScreen("scorecardView");
    setMenuOpen(false);
  }

  function openScorecardEditorForExisting(
    scorecard: ScorecardRecord,
    source: ViewSource,
    profileId: string | null,
  ) {
    setEditorState({
      draft: scorecardToDraft(scorecard),
      editingId: scorecard.id,
      returnView: {
        scorecardId: scorecard.id,
        source,
        profileId,
      },
    });
    setScreen("scorecardEditor");
  }

  function openProfileDetail(profileId: string) {
    setActiveProfileId(profileId);
    setScreen("profileDetail");
    setMenuOpen(false);
  }

  function updateDraftMeta<K extends keyof ScorecardFormState>(key: K, value: ScorecardFormState[K]) {
    setScorecardForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateEditorDraft(updater: (draft: ScorecardDraft) => ScorecardDraft) {
    setEditorState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        draft: updater(current.draft),
      };
    });
  }

  function setHoleValue(index: number, field: keyof HoleDraft, value: string) {
    updateEditorDraft((draft) => ({
      ...draft,
      holes: draft.holes.map((hole, holeIndex) =>
        holeIndex === index ? { ...hole, [field]: value.replace(/[^0-9]/g, "") } : hole,
      ),
    }));
  }

  function setPlayerScore(rowIndex: number, holeIndex: number, value: string) {
    const sanitizedScore = sanitizePlayerScore(value);

    updateEditorDraft((draft) => ({
      ...draft,
      playerRows: draft.playerRows.map((row, currentRowIndex) =>
        currentRowIndex === rowIndex
          ? {
              ...row,
              scores: row.scores.map((score, currentHoleIndex) =>
                currentHoleIndex === holeIndex ? sanitizedScore : score,
              ),
            }
          : row,
      ),
    }));
  }

  function assignProfileToSlot(profileId: string, slotIndex: number) {
    updateEditorDraft((draft) => ({
      ...draft,
      playerRows: draft.playerRows.map((row, rowIndex) =>
        rowIndex === slotIndex ? { ...row, profileId } : row,
      ),
    }));
    setProfilePickerSlot(null);
    setScreen("scorecardEditor");
  }

  function clearProfileSlot(slotIndex: number) {
    updateEditorDraft((draft) => ({
      ...draft,
      playerRows: draft.playerRows.map((row, rowIndex) =>
        rowIndex === slotIndex
          ? {
              profileId: null,
              scores: row.scores.map(() => ""),
            }
          : row,
      ),
    }));
  }

  function saveProfile() {
    const trimmedName = profileForm.name.trim();
    const editingId = profileForm.editingId;

    if (!trimmedName) {
      Alert.alert("Name required", "Enter a name for the profile before saving.");
      return;
    }

    const duplicateProfile = profiles.find(
      (profile) => profile.id !== editingId && normalizeName(profile.name) === normalizeName(trimmedName),
    );

    if (duplicateProfile) {
      Alert.alert("Duplicate profile", "A profile with this name already exists.");
      return;
    }

    if (profileForm.dateOfBirth.trim() && !isValidDateString(profileForm.dateOfBirth.trim())) {
      Alert.alert("Invalid date", "Use the Month/Day/Year format, such as 05/01/2001.");
      return;
    }

    if (editingId) {
      setProfiles((current) =>
        current.map((profile) =>
          profile.id === editingId
            ? {
                ...profile,
                name: trimmedName,
                dateOfBirth: profileForm.dateOfBirth.trim(),
              }
            : profile,
        ),
      );
      setActiveProfileId(editingId);
      setScreen("profileDetail");
      return;
    }

    const newProfile: ProfileRecord = {
      id: createId("profile"),
      name: trimmedName,
      dateOfBirth: profileForm.dateOfBirth.trim(),
      createdAt: new Date().toISOString(),
    };

    setProfiles((current) => [newProfile, ...current]);

    if (profileForm.assignToSlot !== null) {
      assignProfileToSlot(newProfile.id, profileForm.assignToSlot);
      return;
    }

    setActiveProfileId(newProfile.id);
    setScreen("profileDetail");
  }

  function saveScorecard() {
    if (!editorState) {
      return;
    }

    const trimmedCourseName = editorState.draft.meta.courseName.trim();

    if (!trimmedCourseName) {
      Alert.alert("Course name required", "The scorecard still needs a course name.");
      return;
    }

    const missingPars = editorState.draft.holes.some((hole) => parseNumber(hole.par) === null);

    if (missingPars) {
      Alert.alert("Par required", "Enter a par value for every hole before saving this scorecard.");
      return;
    }

    const assignedRows = editorState.draft.playerRows.filter((row) => row.profileId);

    if (assignedRows.length === 0) {
      Alert.alert("Profile required", "Assign at least one player profile to this scorecard.");
      return;
    }

    const hasRecordedScore = assignedRows.some((row) =>
      row.scores.some((scoreText) => parseNumber(scoreText) !== null),
    );

    if (!hasRecordedScore) {
      Alert.alert(
        "Scores required",
        "Record at least one score for one assigned profile before creating the scorecard.",
      );
      return;
    }

    const existingCreatedAt =
      editorState.editingId !== null
        ? scorecards.find((scorecard) => scorecard.id === editorState.editingId)?.createdAt ?? null
        : null;

    const record = buildScorecardRecord(
      {
        ...editorState.draft,
        meta: {
          ...editorState.draft.meta,
          courseName: trimmedCourseName,
          date: editorState.draft.meta.date.trim(),
        },
      },
      editorState.editingId,
      existingCreatedAt,
    );

    setScorecards((current) => {
      const next = editorState.editingId
        ? current.map((scorecard) => (scorecard.id === record.id ? record : scorecard))
        : [record, ...current];

      return next.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    });

    setEditorState(null);
    setScorecardForm(createEmptyForm());

    if (editorState.returnView) {
      setScorecardViewState({
        scorecardId: record.id,
        source: editorState.returnView.source,
        profileId: editorState.returnView.profileId,
      });
      setScreen("scorecardView");
      return;
    }

    openHome("scorecards");
  }

  function cancelProfileForm() {
    if (profileForm.editingId) {
      setActiveProfileId(profileForm.editingId);
      setScreen("profileDetail");
      return;
    }

    if (profileForm.assignToSlot !== null) {
      setScreen("scorecardEditor");
      return;
    }

    openHome("profiles");
  }

  function cancelEditor() {
    if (editorState?.returnView) {
      setScorecardViewState({
        scorecardId: editorState.returnView.scorecardId,
        source: editorState.returnView.source,
        profileId: editorState.returnView.profileId,
      });
      setScreen("scorecardView");
      return;
    }

    openHome("scorecards");
  }

  function backFromScorecardView() {
    if (!scorecardViewState) {
      openHome("scorecards");
      return;
    }

    if (scorecardViewState.source === "profile" && scorecardViewState.profileId) {
      setActiveProfileId(scorecardViewState.profileId);
      setScreen("profileDetail");
      return;
    }

    openHome("scorecards");
  }

  function renderHomeScreen() {
    const sectionTitle = homeSection === "scorecards" ? "Scorecards" : "Profiles";

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.backgroundTop} />
        <ScrollView contentContainerStyle={styles.homeContent}>
          <View style={styles.shell}>
            <View style={styles.topBar}>
              <View style={styles.menuArea}>
                <Pressable
                  onPress={() => setMenuOpen((current) => !current)}
                  style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
                >
                  <View style={styles.menuLines}>
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                  </View>
                </Pressable>
                {menuOpen ? (
                  <View style={styles.menuPopover}>
                    <MenuAction
                      label="Scorecards"
                      active={homeSection === "scorecards"}
                      onPress={() => {
                        setHomeSection("scorecards");
                        setMenuOpen(false);
                      }}
                    />
                    <MenuAction
                      label="Profiles"
                      active={homeSection === "profiles"}
                      onPress={() => {
                        setHomeSection("profiles");
                        setMenuOpen(false);
                      }}
                    />
                  </View>
                ) : null}
              </View>

              <View style={styles.headerBlock}>
                <Text style={styles.pageTitle}>{sectionTitle}</Text>
                <View style={styles.headerRule} />
              </View>
            </View>

            {homeSection === "scorecards" ? renderScorecardsDashboard() : renderProfilesDashboard()}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  function renderScorecardsDashboard() {
    return (
      <>
        <View style={styles.tileGrid}>
          <Pressable
            style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
            onPress={openScorecardForm}
          >
            <View style={styles.plusBadge}>
              <Text style={styles.plusBadgeText}>+</Text>
            </View>
            <Text style={styles.tilePrimary} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
              Add New
            </Text>
            <Text style={styles.tilePrimary} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
              Scorecard
            </Text>
          </Pressable>

          {scorecards.map((scorecard) => (
            <Pressable
              key={scorecard.id}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              onPress={() => openScorecardView(scorecard.id)}
            >
              <Text
                style={styles.tileTitle}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                ellipsizeMode="tail"
              >
                {scorecard.courseName}
              </Text>
              <Text style={styles.tileSubtitle}>{getScorecardSubtitle(scorecard)}</Text>
            </Pressable>
          ))}
        </View>

        {scorecards.length === 0 ? (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Your scorecards will appear here.</Text>
            <Text style={styles.emptyBody}>
              Start with a new round, then older scorecards can be opened in read-only mode and edited
              whenever you want.
            </Text>
          </View>
        ) : null}
      </>
    );
  }

  function renderProfilesDashboard() {
    return (
      <>
        <View style={styles.tileGrid}>
          <Pressable
            style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
            onPress={() => openProfileForm()}
          >
            <View style={styles.plusBadge}>
              <Text style={styles.plusBadgeText}>+</Text>
            </View>
            <Text style={styles.tilePrimary} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
              Create New
            </Text>
            <Text style={styles.tilePrimary} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
              Profile
            </Text>
          </Pressable>

          {profiles.map((profile) => (
            <Pressable
              key={profile.id}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              onPress={() => openProfileDetail(profile.id)}
            >
              <Text
                style={styles.tileTitle}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                ellipsizeMode="tail"
              >
                {profile.name}
              </Text>
              <Text style={styles.tileSubtitle}>Age {calculateAge(profile.dateOfBirth)}</Text>
            </Pressable>
          ))}
        </View>

        {profiles.length === 0 ? (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Create player profiles to reuse them.</Text>
            <Text style={styles.emptyBody}>
              Profiles collect each player's rounds, best and worst rounds, handicap, and hole-by-hole
              scoring stats.
            </Text>
          </View>
        ) : null}
      </>
    );
  }

  function renderScorecardFormScreen() {
    const courseSuggestions = getCourseSuggestions(knownCourseNames, scorecardForm.courseName);

    return (
      <FormShell
        title="Add New Scorecard"
        subtitle="Start a round with the course details, then continue into score entry."
      >
        <LabeledInput
          label="Name of Course"
          required
          placeholder="Enter course name"
          value={scorecardForm.courseName}
          onChangeText={(value) => updateDraftMeta("courseName", value)}
        />

        {courseSuggestions.length > 0 ? (
          <View style={styles.suggestionStack}>
            {courseSuggestions.map((courseName) => (
              <Pressable
                key={courseName}
                onPress={() => updateDraftMeta("courseName", courseName)}
                style={({ pressed }) => [styles.suggestionChip, pressed && styles.pressed]}
              >
                <Text style={styles.suggestionChipText}>{courseName}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <SelectField
          label="Difficulty"
          value={scorecardForm.difficulty}
          placeholder="Select difficulty"
          options={DIFFICULTY_OPTIONS}
          onSelect={(value) => updateDraftMeta("difficulty", value as Difficulty)}
        />

        <SelectField
          label="Holes Played"
          required
          value={scorecardForm.holesPlayed}
          placeholder="Select holes"
          options={HOLE_OPTIONS}
          onSelect={(value) => updateDraftMeta("holesPlayed", value as `${HolesPlayed}`)}
        />

        <LabeledInput
          label="Date"
          placeholder="MM/DD/YYYY"
          value={scorecardForm.date}
          onChangeText={(value) => updateDraftMeta("date", value)}
        />

        <SelectField
          label="Tees"
          value={scorecardForm.tees}
          placeholder="Select tees"
          options={TEE_OPTIONS}
          onSelect={(value) => updateDraftMeta("tees", value as TeeOption)}
        />

        <View style={styles.buttonRow}>
          <ActionButton label="Cancel" tone="ghost" onPress={() => openHome("scorecards")} />
          <ActionButton label="Continue" tone="positive" onPress={openScorecardEditorForCreate} />
        </View>
      </FormShell>
    );
  }

  function renderProfileFormScreen() {
    const isEditingProfile = Boolean(profileForm.editingId);

    return (
      <FormShell
        title={isEditingProfile ? "Edit Profile" : "Create New Profile"}
        subtitle={
          isEditingProfile
            ? "Update the player name or birth date used for profile stats."
            : "Set up a reusable player profile for future rounds and stats."
        }
      >
        <LabeledInput
          label="Name"
          required
          placeholder="Enter player name"
          value={profileForm.name}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, name: value }))}
        />

        <LabeledInput
          label="Date of Birth"
          placeholder="MM/DD/YYYY"
          value={profileForm.dateOfBirth}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, dateOfBirth: value }))}
        />

        <View style={styles.buttonRow}>
          <ActionButton label="Cancel" tone="ghost" onPress={cancelProfileForm} />
          <ActionButton
            label={isEditingProfile ? "Save Changes" : "Save Profile"}
            tone="positive"
            onPress={saveProfile}
          />
        </View>
      </FormShell>
    );
  }

  function renderScorecardViewScreen() {
    if (!viewedScorecard || !scorecardViewState) {
      return (
        <EmptyStateScreen
          title="Scorecard not found"
          body="This round could not be loaded, so the app returned to the main menu."
          actionLabel="Back to Scorecards"
          onPress={() => openHome("scorecards")}
        />
      );
    }

    return (
      <ScorecardShell
        title={`${viewedScorecard.courseName} Scorecard`}
        subtitle="Read-only view"
        chips={[
          `${viewedScorecard.holesPlayed} holes`,
          `Difficulty ${getMetadataValue(viewedScorecard.difficulty)}`,
          `Tees ${getMetadataValue(viewedScorecard.tees)}`,
          getMetadataValue(viewedScorecard.date),
        ]}
      >
        <ScorecardMatrix
          holes={viewedScorecard.holes}
          playerRows={viewedScorecard.playerRows}
          profiles={profiles}
          editable={false}
        />

        <View style={styles.buttonRow}>
          <ActionButton label="Back" tone="ghost" onPress={backFromScorecardView} />
          <ActionButton
            label="Edit"
            tone="positive"
            onPress={() =>
              openScorecardEditorForExisting(
                viewedScorecard,
                scorecardViewState.source,
                scorecardViewState.profileId,
              )
            }
          />
        </View>
      </ScorecardShell>
    );
  }

  function renderScorecardEditorScreen() {
    if (!editorState) {
      return (
        <EmptyStateScreen
          title="Editor unavailable"
          body="There was no active scorecard draft to continue editing."
          actionLabel="Back to Scorecards"
          onPress={() => openHome("scorecards")}
        />
      );
    }

    const draft = editorState.draft;

    return (
      <ScorecardShell
        title={`${draft.meta.courseName || "New"} Scorecard`}
        subtitle="Landscape-friendly score entry"
        chips={[
          `${draft.meta.holesPlayed || "Unknown"} holes`,
          `Difficulty ${getMetadataValue(draft.meta.difficulty)}`,
          `Tees ${getMetadataValue(draft.meta.tees)}`,
          getMetadataValue(draft.meta.date),
        ]}
      >
        <View style={styles.orientationNote}>
          <Text style={styles.orientationNoteTitle}>Built for side-on viewing</Text>
          <Text style={styles.orientationNoteBody}>
            Rotate your phone horizontally when you want the cleanest view of the full scorecard.
          </Text>
        </View>

        <ScorecardMatrix
          holes={draft.holes}
          playerRows={draft.playerRows}
          profiles={profiles}
          editable
          onHoleValueChange={setHoleValue}
          onScoreChange={setPlayerScore}
          onAssignProfile={(slotIndex) => setProfilePickerSlot(slotIndex)}
          onClearProfile={clearProfileSlot}
        />

        <View style={styles.buttonRow}>
          <ActionButton label="Cancel" tone="negative" onPress={cancelEditor} />
          <ActionButton
            label={editorState.editingId ? "Save Changes" : "Create"}
            tone="positive"
            onPress={saveScorecard}
          />
        </View>

        {profilePickerSlot !== null ? renderProfilePickerSheet(profilePickerSlot) : null}
      </ScorecardShell>
    );
  }

  function renderProfilePickerSheet(slotIndex: number) {
    return (
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Choose a Profile</Text>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
            {profiles.map((profile) => (
              <Pressable
                key={profile.id}
                style={({ pressed }) => [styles.sheetOption, pressed && styles.pressed]}
                onPress={() => assignProfileToSlot(profile.id, slotIndex)}
              >
                <Text style={styles.sheetOptionText}>{profile.name}</Text>
                <Text style={styles.sheetOptionMeta}>Age {calculateAge(profile.dateOfBirth)}</Text>
              </Pressable>
            ))}

            {profiles.length === 0 ? (
              <Text style={styles.sheetEmptyText}>No profiles yet. Create your first one below.</Text>
            ) : null}
          </ScrollView>

          <View style={styles.sheetActions}>
            <ActionButton label="Close" tone="ghost" onPress={() => setProfilePickerSlot(null)} />
            <ActionButton label="Create New" tone="positive" onPress={() => openProfileForm(slotIndex)} />
          </View>
        </View>
      </View>
    );
  }

  function renderProfileDetailScreen() {
    if (!viewedProfile || !viewedProfileStats) {
      return (
        <EmptyStateScreen
          title="Profile not found"
          body="This player profile could not be loaded."
          actionLabel="Back to Profiles"
          onPress={() => openHome("profiles")}
        />
      );
    }

    const age = calculateAge(viewedProfile.dateOfBirth);

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.backgroundTop} />
        <ScrollView contentContainerStyle={styles.homeContent}>
          <View style={styles.profileShell}>
            <View style={styles.profileHeader}>
              <Text style={styles.profileName}>{viewedProfile.name}</Text>
              <Text style={styles.profileDivider}>|</Text>
              <Text style={styles.profileAge}>Age: {age}</Text>
            </View>
            <View style={styles.headerRule} />

            <View style={styles.profileCard}>
              <StatisticLinkRow
                label="Best Round"
                value={viewedProfileStats.bestRound ? formatRoundLink(viewedProfileStats.bestRound) : "Unknown"}
                onPress={
                  viewedProfileStats.bestRound
                    ? () => openScorecardView(viewedProfileStats.bestRound!.scorecard.id, "profile", viewedProfile.id)
                    : undefined
                }
              />
              <StatisticLinkRow
                label="Worst Round"
                value={
                  viewedProfileStats.worstRound ? formatRoundLink(viewedProfileStats.worstRound) : "Unknown"
                }
                onPress={
                  viewedProfileStats.worstRound
                    ? () => openScorecardView(viewedProfileStats.worstRound!.scorecard.id, "profile", viewedProfile.id)
                    : undefined
                }
              />
              <StatisticTrendRow
                label="Handicap per 9 holes"
                value={formatSigned(viewedProfileStats.handicap, 1)}
                trend={viewedProfileStats.handicapTrend}
              />
              <StatisticRow
                label="Handicap per 18 holes"
                value={formatSigned(viewedProfileStats.handicapPer18, 1)}
              />

              <View style={styles.statBlockSpacer} />

              <StatisticRow label="Hole in Ones" value={`${viewedProfileStats.tally.holeInOnes}`} />
              <StatisticRow label="Albatrosses" value={`${viewedProfileStats.tally.albatrosses}`} />
              <StatisticRow label="Eagles" value={`${viewedProfileStats.tally.eagles}`} />
              <StatisticRow label="Birdies" value={`${viewedProfileStats.tally.birdies}`} />
              <StatisticRow label="Pars" value={`${viewedProfileStats.tally.pars}`} />
              <StatisticRow label="Bogeys" value={`${viewedProfileStats.tally.bogeys}`} />
              <StatisticRow label="Double Bogeys" value={`${viewedProfileStats.tally.doubleBogeys}`} />
              <StatisticRow label="Triple Bogeys" value={`${viewedProfileStats.tally.tripleBogeys}`} />
            </View>

            <View style={[styles.buttonRow, styles.singleButtonRow]}>
              <ActionButton label="Back" tone="ghost" onPress={() => openHome("profiles")} />
              <ActionButton label="Edit Profile" tone="positive" onPress={() => openProfileEditor(viewedProfile)} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "home") {
    return renderHomeScreen();
  }

  if (screen === "scorecardForm") {
    return renderScorecardFormScreen();
  }

  if (screen === "scorecardEditor") {
    return renderScorecardEditorScreen();
  }

  if (screen === "scorecardView") {
    return renderScorecardViewScreen();
  }

  if (screen === "profileForm") {
    return renderProfileFormScreen();
  }

  return renderProfileDetailScreen();
}

function FormShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.backgroundTop} />
      <KeyboardAvoidingView
        style={styles.keyboardShell}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.formContent}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{title}</Text>
            <Text style={styles.formSubtitle}>{subtitle}</Text>
            <View style={styles.formStack}>{children}</View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ScorecardShell({
  title,
  subtitle,
  chips,
  children,
}: {
  title: string;
  subtitle: string;
  chips: string[];
  children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.scorecardBackdrop} />
      <ScrollView contentContainerStyle={styles.scorecardShellContent}>
        <View style={styles.scorecardShell}>
          <Text style={styles.scorecardTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.68}>
            {title}
          </Text>
          <Text style={styles.scorecardSubtitle}>{subtitle}</Text>
          <View style={styles.chipRow}>
            {chips.map((chip) => (
              <View key={chip} style={styles.metaChip}>
                <Text style={styles.metaChipText}>{chip}</Text>
              </View>
            ))}
          </View>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ScorecardMatrix({
  holes,
  playerRows,
  profiles,
  editable,
  onHoleValueChange,
  onScoreChange,
  onAssignProfile,
  onClearProfile,
}: {
  holes: HoleDraft[];
  playerRows: PlayerRowDraft[];
  profiles: ProfileRecord[];
  editable: boolean;
  onHoleValueChange?: (index: number, field: keyof HoleDraft, value: string) => void;
  onScoreChange?: (rowIndex: number, holeIndex: number, value: string) => void;
  onAssignProfile?: (slotIndex: number) => void;
  onClearProfile?: (slotIndex: number) => void;
}) {
  return (
    <View style={styles.matrixFrame}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.matrixTable}>
          <MatrixRow label="Hole">
            {holes.map((_, index) => (
              <StaticCell key={`hole-${index}`} value={`${index + 1}`} />
            ))}
            <StaticCell value="Total" emphasis />
          </MatrixRow>

          <MatrixRow label="Par">
            {holes.map((hole, index) => (
              <InputCell
                key={`par-${index}`}
                editable={editable}
                value={hole.par}
                placeholder="4"
                onChangeText={(value) => onHoleValueChange?.(index, "par", value)}
              />
            ))}
            <StaticCell value={formatHoleTotal(holes, "par")} emphasis />
          </MatrixRow>

          <MatrixRow label="Yardage">
            {holes.map((hole, index) => (
              <InputCell
                key={`yardage-${index}`}
                editable={editable}
                value={hole.yardage}
                placeholder="311"
                onChangeText={(value) => onHoleValueChange?.(index, "yardage", value)}
              />
            ))}
            <StaticCell value={formatHoleTotal(holes, "yardage")} emphasis />
          </MatrixRow>

          {playerRows.map((row, rowIndex) => {
            const profile = profiles.find((item) => item.id === row.profileId) ?? null;

            return (
              <MatrixRow
                key={`player-row-${rowIndex}`}
                label={profile ? profile.name : `Player ${rowIndex + 1}`}
                labelAction={
                  editable ? (
                    <View style={styles.playerActions}>
                      <Pressable
                        onPress={() => onAssignProfile?.(rowIndex)}
                        style={({ pressed }) => [styles.assignButton, pressed && styles.pressed]}
                      >
                        <Text style={styles.assignButtonText}>{profile ? "Swap" : "+ Assign"}</Text>
                      </Pressable>
                      {profile ? (
                        <Pressable
                          onPress={() => onClearProfile?.(rowIndex)}
                          style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
                        >
                          <Text style={styles.clearButtonText}>Clear</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null
                }
              >
                {holes.map((hole, holeIndex) => {
                  const scoreShape = getScoreShape(row.scores[holeIndex] ?? "", hole.par);

                  return (
                    <InputCell
                      key={`score-${rowIndex}-${holeIndex}`}
                      editable={editable && Boolean(profile)}
                      value={row.scores[holeIndex] ?? ""}
                      placeholder={profile ? "-" : ""}
                      onChangeText={(value) => onScoreChange?.(rowIndex, holeIndex, value)}
                      shape={scoreShape}
                      maxLength={1}
                    />
                  );
                })}
                <StaticCell value={profile ? formatTotal(row.scores) : "-"} emphasis />
              </MatrixRow>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function MatrixRow({
  label,
  labelAction,
  children,
}: {
  label: string;
  labelAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.matrixRow}>
      <View style={styles.matrixLabelCell}>
        <Text style={styles.matrixLabelText}>{label}</Text>
        {labelAction}
      </View>
      {children}
    </View>
  );
}

function StaticCell({ value, emphasis = false }: { value: string; emphasis?: boolean }) {
  return (
    <View style={[styles.matrixCell, emphasis && styles.totalCell]}>
      <Text style={[styles.staticCellText, emphasis && styles.totalCellText]}>{value}</Text>
    </View>
  );
}

function InputCell({
  editable,
  value,
  placeholder,
  onChangeText,
  shape = "none",
  maxLength,
}: {
  editable: boolean;
  value: string;
  placeholder: string;
  onChangeText?: (value: string) => void;
  shape?: "none" | "circle" | "square" | "doubleSquare";
  maxLength?: number;
}) {
  const shapeStyle =
    shape === "circle"
      ? styles.circleMarker
      : shape === "square"
        ? styles.squareMarker
        : shape === "doubleSquare"
          ? styles.doubleSquareMarker
          : styles.plainMarker;

  return (
    <View style={styles.matrixCell}>
      <View style={[styles.markerShell, shapeStyle]}>
        <TextInput
          editable={editable}
          style={[styles.cellInput, !editable && styles.readOnlyCellInput]}
          value={value}
          placeholder={placeholder}
          placeholderTextColor="#7b8b80"
          keyboardType="number-pad"
          onChangeText={onChangeText}
          textAlign="center"
          maxLength={maxLength}
        />
      </View>
    </View>
  );
}

function LabeledInput({
  label,
  required,
  placeholder,
  value,
  onChangeText,
}: {
  label: string;
  required?: boolean;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.fieldStack}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.requiredMark}> *</Text> : null}
      </Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        placeholder={placeholder}
        placeholderTextColor="#7e8e85"
        onChangeText={onChangeText}
      />
    </View>
  );
}

function SelectField({
  label,
  required,
  value,
  placeholder,
  options,
  onSelect,
}: {
  label: string;
  required?: boolean;
  value: string;
  placeholder: string;
  options: string[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.fieldStack}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.requiredMark}> *</Text> : null}
      </Text>

      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.selectTrigger, pressed && styles.pressed]}
      >
        <Text style={[styles.selectValue, !value && styles.selectPlaceholder]}>
          {value || placeholder}
        </Text>
        <Text style={styles.selectCaret}>{open ? "▲" : "▼"}</Text>
      </Pressable>

      {open ? (
        <View style={styles.selectMenu}>
          {options.map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                onSelect(option);
                setOpen(false);
              }}
              style={({ pressed }) => [styles.selectOption, pressed && styles.pressed]}
            >
              <Text style={styles.selectOptionText}>{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function MenuAction({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuAction, active && styles.menuActionActive, pressed && styles.pressed]}>
      <Text style={[styles.menuActionText, active && styles.menuActionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: "ghost" | "positive" | "negative";
  onPress: () => void;
}) {
  const toneStyle =
    tone === "positive"
      ? styles.buttonPositive
      : tone === "negative"
        ? styles.buttonNegative
        : styles.buttonGhost;

  const textToneStyle =
    tone === "ghost" ? styles.buttonGhostText : styles.buttonFilledText;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionButton, toneStyle, pressed && styles.pressed]}>
      <Text style={[styles.actionButtonText, textToneStyle]}>{label}</Text>
    </Pressable>
  );
}

function StatisticRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function StatisticLinkRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      {onPress ? (
        <Pressable onPress={onPress}>
          <Text style={styles.statLink}>{value}</Text>
        </Pressable>
      ) : (
        <Text style={styles.statUnknown}>{value}</Text>
      )}
    </View>
  );
}

function StatisticTrendRow({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: number | null;
}) {
  const trendValue = trend === null ? "Unknown" : formatSigned(trend, 1);
  const trendStyle =
    trend === null
      ? styles.statUnknown
      : trend > 0
        ? styles.trendUp
        : trend < 0
          ? styles.trendDown
          : styles.statValue;

  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.trendValueRow}>
        <Text style={styles.statLink}>{value}</Text>
        <Text style={styles.trendDivider}>|</Text>
        <Text style={trendStyle}>{trendValue}</Text>
      </View>
    </View>
  );
}

function EmptyStateScreen({
  title,
  body,
  actionLabel,
  onPress,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.backgroundTop} />
      <View style={styles.emptyScreen}>
        <View style={styles.emptyScreenCard}>
          <Text style={styles.emptyTitle}>{title}</Text>
          <Text style={styles.emptyBody}>{body}</Text>
          <ActionButton label={actionLabel} tone="positive" onPress={onPress} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function formatRoundLink(round: ProfileRound): string {
  return `${formatSigned(round.overUnder)} ${round.scorecard.courseName} / ${round.scorecard.holesPlayed} holes`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0d2f22",
  },
  backgroundTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#114431",
  },
  keyboardShell: {
    flex: 1,
  },
  homeContent: {
    padding: 18,
    paddingBottom: 32,
  },
  shell: {
    backgroundColor: "#f4efe1",
    borderRadius: 34,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    minHeight: "100%",
    shadowColor: "#06150f",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
  profileShell: {
    backgroundColor: "#f4efe1",
    borderRadius: 34,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 24,
    minHeight: "100%",
    shadowColor: "#06150f",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    position: "relative",
    zIndex: 60,
    elevation: 60,
  },
  menuArea: {
    width: 54,
    position: "relative",
    zIndex: 70,
    elevation: 70,
  },
  menuButton: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#f7f3eb",
    borderWidth: 2,
    borderColor: "#153628",
    alignItems: "center",
    justifyContent: "center",
  },
  menuLines: {
    gap: 5,
  },
  menuLine: {
    width: 22,
    height: 2.5,
    borderRadius: 4,
    backgroundColor: "#153628",
  },
  menuPopover: {
    position: "absolute",
    top: 60,
    left: 0,
    width: 170,
    backgroundColor: "#f7f3eb",
    borderRadius: 22,
    padding: 10,
    borderWidth: 2,
    borderColor: "#173628",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    zIndex: 90,
    elevation: 90,
  },
  menuAction: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuActionActive: {
    backgroundColor: "#dbe8da",
  },
  menuActionText: {
    color: "#153628",
    fontSize: 16,
    fontWeight: "700",
  },
  menuActionTextActive: {
    color: "#0d2f22",
  },
  headerBlock: {
    flex: 1,
    paddingTop: 8,
  },
  pageTitle: {
    color: "#0d2419",
    fontSize: 34,
    fontWeight: "800",
    textAlign: "center",
  },
  headerRule: {
    height: 3,
    borderRadius: 999,
    backgroundColor: "#113a2a",
    marginTop: 14,
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    paddingTop: 22,
    zIndex: 1,
    elevation: 1,
  },
  tile: {
    width: "47%",
    minHeight: 168,
    backgroundColor: "#fbf8f0",
    borderRadius: 28,
    borderWidth: 3,
    borderColor: "#153628",
    padding: 20,
    justifyContent: "space-between",
  },
  addTile: {
    width: "47%",
    minHeight: 168,
    backgroundColor: "#edf4e6",
    borderRadius: 28,
    borderWidth: 3,
    borderColor: "#153628",
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  plusBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#f8faf4",
    borderWidth: 2,
    borderColor: "#153628",
    alignItems: "center",
    justifyContent: "center",
  },
  plusBadgeText: {
    fontSize: 22,
    lineHeight: 24,
    color: "#153628",
    fontWeight: "800",
  },
  tilePrimary: {
    color: "#153628",
    fontSize: 23,
    fontWeight: "800",
    textAlign: "center",
    width: "100%",
  },
  tileTitle: {
    color: "#12261d",
    fontSize: 24,
    fontWeight: "800",
    flexShrink: 1,
  },
  tileSubtitle: {
    color: "#52675c",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  emptyPanel: {
    marginTop: 26,
    backgroundColor: "#e5efe6",
    borderRadius: 24,
    padding: 18,
    gap: 6,
  },
  emptyTitle: {
    color: "#163223",
    fontSize: 21,
    fontWeight: "800",
  },
  emptyBody: {
    color: "#4d6357",
    fontSize: 15,
    lineHeight: 22,
  },
  formContent: {
    padding: 18,
    paddingBottom: 32,
  },
  formCard: {
    backgroundColor: "#f4efe1",
    borderRadius: 32,
    padding: 24,
    gap: 18,
    shadowColor: "#06150f",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
  formTitle: {
    color: "#12261d",
    fontSize: 30,
    fontWeight: "800",
  },
  formSubtitle: {
    color: "#587064",
    fontSize: 16,
    lineHeight: 23,
  },
  formStack: {
    gap: 16,
  },
  fieldStack: {
    gap: 8,
  },
  suggestionStack: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: -8,
  },
  suggestionChip: {
    backgroundColor: "#e4ede0",
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#c0d1c3",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionChipText: {
    color: "#173628",
    fontSize: 14,
    fontWeight: "700",
  },
  fieldLabel: {
    color: "#173628",
    fontSize: 15,
    fontWeight: "700",
  },
  requiredMark: {
    color: "#b8372f",
  },
  fieldInput: {
    backgroundColor: "#fbf8f0",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#bdd0c2",
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#173628",
  },
  selectTrigger: {
    backgroundColor: "#fbf8f0",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#bdd0c2",
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectValue: {
    color: "#173628",
    fontSize: 16,
  },
  selectPlaceholder: {
    color: "#7e8e85",
  },
  selectCaret: {
    color: "#446154",
    fontSize: 13,
    fontWeight: "800",
  },
  selectMenu: {
    backgroundColor: "#f8f4eb",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#c0d1c3",
    overflow: "hidden",
  },
  selectOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectOptionText: {
    color: "#173628",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  singleButtonRow: {
    marginTop: 20,
  },
  actionButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPositive: {
    backgroundColor: "#1c6d43",
  },
  buttonNegative: {
    backgroundColor: "#b63a34",
  },
  buttonGhost: {
    backgroundColor: "#eef3e7",
    borderWidth: 1.5,
    borderColor: "#cad8cc",
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "800",
  },
  buttonFilledText: {
    color: "#f8faf6",
  },
  buttonGhostText: {
    color: "#173628",
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  scorecardBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0d2f22",
  },
  scorecardShellContent: {
    padding: 16,
    paddingBottom: 30,
  },
  scorecardShell: {
    backgroundColor: "#f3eee0",
    borderRadius: 28,
    padding: 18,
    gap: 16,
    shadowColor: "#04110c",
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  scorecardTitle: {
    color: "#10261b",
    fontSize: 29,
    fontWeight: "800",
  },
  scorecardSubtitle: {
    color: "#567164",
    fontSize: 15,
    fontWeight: "600",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    backgroundColor: "#e4ede0",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  metaChipText: {
    color: "#173628",
    fontSize: 13,
    fontWeight: "700",
  },
  orientationNote: {
    backgroundColor: "#e2eee4",
    borderRadius: 20,
    padding: 14,
    gap: 4,
  },
  orientationNoteTitle: {
    color: "#173628",
    fontSize: 15,
    fontWeight: "800",
  },
  orientationNoteBody: {
    color: "#4b6158",
    fontSize: 14,
    lineHeight: 20,
  },
  matrixFrame: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#153628",
    backgroundColor: "#fbf8f0",
    overflow: "hidden",
  },
  matrixTable: {
    paddingBottom: 4,
  },
  matrixRow: {
    flexDirection: "row",
    minHeight: 72,
    borderBottomWidth: 2,
    borderBottomColor: "#153628",
  },
  matrixLabelCell: {
    width: LABEL_WIDTH,
    borderRightWidth: 2,
    borderRightColor: "#153628",
    padding: 10,
    justifyContent: "center",
    backgroundColor: "#f3eee0",
    gap: 8,
  },
  matrixLabelText: {
    color: "#12261d",
    fontSize: 18,
    fontWeight: "800",
  },
  matrixCell: {
    width: CELL_WIDTH,
    borderRightWidth: 2,
    borderRightColor: "#153628",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  totalCell: {
    backgroundColor: "#e4ede0",
  },
  staticCellText: {
    color: "#173628",
    fontSize: 20,
    fontWeight: "800",
  },
  totalCellText: {
    color: "#10261b",
  },
  markerShell: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  plainMarker: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#c4d1c6",
    backgroundColor: "#fefcf7",
  },
  circleMarker: {
    borderRadius: 26,
    borderWidth: 2.5,
    borderColor: "#326c4d",
    backgroundColor: "#fdfcf7",
  },
  squareMarker: {
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: "#7d5b20",
    backgroundColor: "#fdfcf7",
  },
  doubleSquareMarker: {
    borderRadius: 8,
    borderWidth: 4,
    borderColor: "#a53d33",
    backgroundColor: "#fdfcf7",
  },
  cellInput: {
    width: "100%",
    color: "#173628",
    fontSize: 18,
    fontWeight: "800",
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  readOnlyCellInput: {
    color: "#173628",
  },
  playerActions: {
    gap: 8,
  },
  assignButton: {
    backgroundColor: "#1b6440",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  assignButtonText: {
    color: "#f8faf6",
    fontSize: 13,
    fontWeight: "700",
  },
  clearButton: {
    backgroundColor: "#eef3e7",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#cad8cc",
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  clearButtonText: {
    color: "#173628",
    fontSize: 13,
    fontWeight: "700",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 16, 12, 0.32)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#f5efe2",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 18,
    gap: 12,
  },
  sheetTitle: {
    color: "#12261d",
    fontSize: 22,
    fontWeight: "800",
  },
  sheetList: {
    maxHeight: 280,
  },
  sheetListContent: {
    gap: 10,
    paddingBottom: 4,
  },
  sheetOption: {
    backgroundColor: "#fbf8f0",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "#d0dbcf",
  },
  sheetOptionText: {
    color: "#173628",
    fontSize: 17,
    fontWeight: "800",
  },
  sheetOptionMeta: {
    color: "#567164",
    fontSize: 14,
    marginTop: 4,
  },
  sheetEmptyText: {
    color: "#567164",
    fontSize: 15,
    lineHeight: 22,
  },
  sheetActions: {
    flexDirection: "row",
    gap: 12,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  profileName: {
    color: "#10261b",
    fontSize: 28,
    fontWeight: "800",
    flex: 1,
  },
  profileDivider: {
    color: "#10261b",
    fontSize: 36,
    fontWeight: "300",
  },
  profileAge: {
    color: "#10261b",
    fontSize: 22,
    fontWeight: "800",
  },
  profileCard: {
    backgroundColor: "#fbf8f0",
    borderRadius: 26,
    padding: 18,
    marginTop: 18,
    gap: 8,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  statLabel: {
    color: "#142b1f",
    fontSize: 17,
    fontWeight: "800",
    flex: 1,
  },
  statValue: {
    color: "#142b1f",
    fontSize: 17,
    fontWeight: "700",
  },
  statLink: {
    color: "#1883d9",
    fontSize: 17,
    fontWeight: "800",
  },
  statUnknown: {
    color: "#70857a",
    fontSize: 17,
    fontWeight: "700",
  },
  statBlockSpacer: {
    height: 8,
  },
  trendValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trendDivider: {
    color: "#90a39a",
    fontSize: 18,
    fontWeight: "500",
  },
  trendUp: {
    color: "#b63a34",
    fontSize: 17,
    fontWeight: "800",
  },
  trendDown: {
    color: "#1f8b54",
    fontSize: 17,
    fontWeight: "800",
  },
  emptyScreen: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
  },
  emptyScreenCard: {
    backgroundColor: "#f4efe1",
    borderRadius: 26,
    padding: 22,
    gap: 14,
  },
});
