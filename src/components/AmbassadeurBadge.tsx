import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function ExplorateurBadge() {
  return (
    <View style={styles.dotExp}>
      <Ionicons name="compass" size={8} color="#fff" />
    </View>
  );
}

export function BirthdayBadge() {
  return (
    <View style={styles.dotBirthday}>
      <Ionicons name="sparkles" size={8} color="#fff" />
    </View>
  );
}

export function AmbassadeurBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  if (size === 'md') {
    return (
      <View style={styles.pillMd}>
        <Ionicons name="star" size={10} color="#fff" />
        <Text style={styles.pillMdLabel}>Ambassadeur</Text>
      </View>
    );
  }
  return (
    <View style={styles.dot}>
      <Ionicons name="star" size={8} color="#fff" />
    </View>
  );
}

// Paliers de parrainage (cf. migration parrainage : 1, 5, 10 filleuls valides)
export const PALIERS_PARRAINAGE = [
  { palier: 1, min: 1, nom: 'Parrain', icon: 'paw' as const, color: '#2E7D6B' },
  { palier: 2, min: 5, nom: 'Chef de meute', icon: 'people' as const, color: '#C4693A' },
  { palier: 3, min: 10, nom: 'Alpha', icon: 'trophy' as const, color: '#3D1A1A' },
];

export function palierParrainage(nbFilleuls: number) {
  return [...PALIERS_PARRAINAGE].reverse().find(p => nbFilleuls >= p.min) ?? null;
}

export function ParrainBadge({ nbFilleuls, size = 'sm' }: { nbFilleuls: number; size?: 'sm' | 'md' }) {
  const p = palierParrainage(nbFilleuls);
  if (!p) return null;
  if (size === 'md') {
    return (
      <View style={[styles.pillMd, { backgroundColor: p.color }]}>
        <Ionicons name={p.icon} size={10} color="#fff" />
        <Text style={styles.pillMdLabel}>{p.nom}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.dot, { backgroundColor: p.color }]}>
      <Ionicons name={p.icon} size={8} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 15, height: 15, borderRadius: 8,
    backgroundColor: '#C9A826',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
  dotExp: {
    width: 15, height: 15, borderRadius: 8,
    backgroundColor: '#3a7bd5',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
  dotBirthday: {
    width: 15, height: 15, borderRadius: 8,
    backgroundColor: '#C4693A',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
  pillMd: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#C9A826',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  pillMdLabel: {
    fontSize: 11, fontFamily: 'DMSans_500Medium', color: '#fff', letterSpacing: 0.3,
  },
});
