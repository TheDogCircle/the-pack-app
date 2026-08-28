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
      <Text style={styles.dotBirthdayEmoji}>🕯️</Text>
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
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
  dotBirthdayEmoji: {
    fontSize: 12, lineHeight: 14,
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
