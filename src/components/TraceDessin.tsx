import React, { useMemo } from 'react';
import { View } from 'react-native';

// Dessine la FORME d'un trace (sans fond de carte) : aucune rue ni adresse
// visible, donc partageable sans exposer le domicile. Segments = Views tournees
// (pas de react-native-svg dans l'app, et rien de natif a ajouter pour l'OTA).

type Point = { latitude: number; longitude: number; b?: 1 };

export default function TraceDessin({
  trace, width, height, color, epaisseur = 4, marge = 12,
}: {
  trace: Point[]; width: number; height: number; color: string; epaisseur?: number; marge?: number;
}) {
  const segments = useMemo(() => {
    if (!trace || trace.length < 2) return [];
    // Echantillonnage : 120 points max suffisent pour la forme
    const pas = Math.max(1, Math.floor(trace.length / 120));
    const pts = trace.filter((_, i) => i % pas === 0 || i === trace.length - 1);
    const lats = pts.map(p => p.latitude), lngs = pts.map(p => p.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    // Correction de la longitude selon la latitude, pour garder les proportions
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const spanX = Math.max((maxLng - minLng) * k, 1e-6), spanY = Math.max(maxLat - minLat, 1e-6);
    const echelle = Math.min((width - marge * 2) / spanX, (height - marge * 2) / spanY);
    const offX = (width - spanX * echelle) / 2, offY = (height - spanY * echelle) / 2;
    const xy = pts.map(p => ({
      x: offX + (p.longitude - minLng) * k * echelle,
      y: offY + (maxLat - p.latitude) * echelle,
      b: p.b,
    }));
    const out: { left: number; top: number; len: number; angle: number }[] = [];
    for (let i = 1; i < xy.length; i++) {
      if (xy[i].b) continue;
      const a = xy[i - 1], c = xy[i];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      if (len < 0.5) continue;
      out.push({ left: (a.x + c.x) / 2 - len / 2, top: (a.y + c.y) / 2 - epaisseur / 2, len, angle: Math.atan2(c.y - a.y, c.x - a.x) });
    }
    return out;
  }, [trace, width, height, epaisseur, marge]);

  return (
    <View style={{ width, height }}>
      {segments.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute', left: s.left, top: s.top,
            width: s.len + epaisseur * 0.6, height: epaisseur, borderRadius: epaisseur / 2,
            backgroundColor: color, transform: [{ rotate: `${s.angle}rad` }],
          }}
        />
      ))}
    </View>
  );
}
