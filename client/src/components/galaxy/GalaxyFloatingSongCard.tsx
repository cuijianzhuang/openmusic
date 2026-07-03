import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getCoverUrl } from '../../api/music';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackDuration, clampPlaybackTime } from '../../hooks/useTrackDuration';
import { useFavorites } from '../../hooks/useFavorites';
import { useSocket } from '../../hooks/useSocket';
import { getClientId } from '../../lib/clientId';
import { roomVisualFxLive } from '../../lib/roomVisualFxLive';
import { useRoomStore } from '../../stores/roomStore';
import type { QueueItem } from '../../types';
import { getCachedGalaxyAudioBands } from './lib/galaxyAudio';
import { releaseGalaxyPointerInteraction } from './lib/galaxyGestureRotation';
import { galaxyOrbitRef, setGalaxyOrbitFocusZone } from './lib/galaxyOrbit';
import {
  applyFloatingSongCardPose,
  createFloatingSongCardMesh,
  disposeFloatingSongCardMesh,
  drawFloatingSongCard,
  hitTestFloatingSongCardAction,
  type FloatingSongCardAction,
  type FloatingSongCardActionId,
  type FloatingSongCardActionRegion,
  type FloatingSongCardItem,
} from './lib/galaxyFloatingSongCard';

const CLICK_THRESHOLD = 6;
const SHELF_VISIBLE_RADIUS = 5;
const MAX_SHELF_ITEMS = 24;

type DisplayQueueItem = QueueItem & { isCurrent: boolean };

type CardSlot = ReturnType<typeof createFloatingSongCardMesh>;

function makeCardFocusZone(
  mode: 'side' | 'stage',
  index: number,
): { theta: number; phi: number; radius: number; lookAt: THREE.Vector3; ease: number } {
  if (mode === 'stage') {
    return {
      theta: -0.08 + index * 0.08,
      phi: -0.2,
      radius: 4.36 + Math.min(index, 2) * 0.08,
      lookAt: new THREE.Vector3((index - 1.5) * 0.72, -1.28, 0.86 - index * 0.03),
      ease: 0.1,
    };
  }
  return {
    theta: 0.28,
    phi: -0.04 + (1.5 - index) * 0.025,
    radius: 4.74 + Math.min(index, 3) * 0.05,
    lookAt: new THREE.Vector3(1.78, 0.22 - index * 0.9, 0.84 - index * 0.08),
    ease: 0.1,
  };
}

export default function GalaxyFloatingSongCard() {
  const room = useRoomStore((s) => s.room);
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const { toggleFavorite, isFavorite } = useFavorites();
  const { removeSong, requestJump, toggleQueueLike, banRoomSong } = useSocket();
  const current = room?.current ?? null;
  const currentTime = useSmoothPlaybackTime();
  const duration = useTrackDuration(current);
  const displayTime = clampPlaybackTime(currentTime, duration);
  const progress = duration > 0 ? displayTime / duration : 0;
  const { camera, gl, pointer } = useThree();
  const cardsRef = useRef<CardSlot[]>([]);
  const drawKeyRef = useRef<string[]>([]);
  const hoverRef = useRef<number[]>([]);
  const pulseRef = useRef<number[]>([]);
  const presenceRef = useRef(
    roomVisualFxLive.current.shelfPresence === 'always' ? 1 : 0,
  );
  const raycasterRef = useRef(new THREE.Raycaster());
  const actionRegionsRef = useRef<FloatingSongCardActionRegion[][]>([]);
  const hoveredCardRef = useRef<number>(-1);
  const hoveredActionRef = useRef<FloatingSongCardActionId | null>(null);
  const pointerDownRef = useRef<{
    x: number;
    y: number;
    cardIndex: number;
    actionId: FloatingSongCardActionId | null;
  } | null>(null);
  const actionBusyRef = useRef<string | null>(null);
  const centerTargetRef = useRef(0);
  const centerSmoothRef = useRef(0);
  const [actionRevision, setActionRevision] = useState(0);
  const [cardCount, setCardCount] = useState(0);

  const displaySongs = useMemo<DisplayQueueItem[]>(() => {
    if (!room) return [];
    const items = [
      ...(room.current ? [{ ...room.current, isCurrent: true }] : []),
      ...room.queue.map((song) => ({ ...song, isCurrent: false })),
    ];
    return items.slice(0, MAX_SHELF_ITEMS);
  }, [room]);

  const displayItems = useMemo(() => {
    const myUserId = mySocketId || getClientId();
    return displaySongs.map((song, index) => {
      const likedByIds = Array.isArray(song.likedByIds) ? song.likedByIds : [];
      const likedByMe = Boolean(myUserId && likedByIds.includes(myUserId));
      const favorite = isFavorite(song);
      const isMine =
        !song.isCurrent &&
        Boolean(myUserId && (song.requestedById === myUserId || (!song.requestedById && song.requestedBy === nickname)));
      const actions: FloatingSongCardAction[] = [
        { id: 'favorite', label: favorite ? '已收藏' : '收藏', active: favorite, tone: 'rose' },
      ];
      if (!song.isCurrent) {
        actions.push({
          id: 'like',
          label: likedByMe ? '已点赞' : '点赞',
          active: likedByMe,
          tone: 'sky',
          badge: likedByIds.length > 0 ? String(likedByIds.length) : undefined,
        });
        if (canControlPlayback || isMine) {
          actions.push({ id: 'jump', label: '插队', tone: 'amber' });
          actions.push({ id: 'remove', label: '删除', tone: 'red' });
        }
        if (canControlPlayback) {
          actions.push({ id: 'ban', label: '禁播', tone: 'amber' });
        }
      }

      const coverUrl = getCoverUrl(song, 'medium');
      const tag = song.isCurrent ? '正在播放' : index === 1 ? '下一首' : `队列 ${index}`;
      const meta = song.isCurrent
        ? `${Math.round(progress * 100)}% · ${song.album || '当前曲目'}`
        : `${song.requestedBy || '匿名'} 点歌`;
      const item: FloatingSongCardItem = {
        title: song.name,
        sub: song.artist || '未知歌手',
        coverUrl,
        tag,
        progress: song.isCurrent ? progress : 0,
        bass: 0,
        meta,
        isCurrent: song.isCurrent,
        actions,
      };
      return { song, item, likedByMe };
    });
  }, [canControlPlayback, displaySongs, isFavorite, mySocketId, nickname, progress, actionRevision]);

  useEffect(() => {
    const nextCount = displayItems.length;
    while (cardsRef.current.length < nextCount) {
      const built = createFloatingSongCardMesh();
      built.mesh.userData.cardIndex = cardsRef.current.length;
      cardsRef.current.push(built);
      drawKeyRef.current.push('');
      hoverRef.current.push(0);
      pulseRef.current.push(0);
      actionRegionsRef.current.push([]);
    }
    while (cardsRef.current.length > nextCount) {
      const removed = cardsRef.current.pop();
      if (removed) disposeFloatingSongCardMesh(removed.mesh);
      drawKeyRef.current.pop();
      hoverRef.current.pop();
      pulseRef.current.pop();
      actionRegionsRef.current.pop();
    }
    setCardCount(nextCount);
  }, [displayItems.length]);

  useEffect(() => {
    if (displayItems.length === 0) {
      centerTargetRef.current = 0;
      centerSmoothRef.current = 0;
      return;
    }
    const currentIdx = Math.max(0, displayItems.findIndex((entry) => entry.song.isCurrent));
    centerTargetRef.current = Math.min(displayItems.length - 1, currentIdx);
    centerSmoothRef.current = centerTargetRef.current;
  }, [displayItems.length]);

  useEffect(
    () => () => {
      gl.domElement.style.cursor = '';
      for (const card of cardsRef.current) disposeFloatingSongCardMesh(card.mesh);
      cardsRef.current = [];
    },
    [gl],
  );

  const getHitAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
      raycasterRef.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const objects = cardsRef.current
        .map((card) => card.mesh)
        .filter((mesh) => mesh.visible)
        .sort((a, b) => (b.renderOrder || 0) - (a.renderOrder || 0));
      const hits = raycasterRef.current.intersectObjects(objects, false);
      if (!hits.length) return null;
      const hit = hits[0];
      const cardIndex = Number(hit.object.userData.cardIndex ?? -1);
      if (cardIndex < 0) return null;
      const uv = hit.uv;
      const x = (uv?.x ?? 0) * 720;
      const y = (1 - (uv?.y ?? 0)) * 360;
      const actionId = hitTestFloatingSongCardAction(actionRegionsRef.current[cardIndex] || [], x, y);
      return { cardIndex, x, y, actionId };
    },
    [camera, gl],
  );

  const runCardAction = useCallback(
    async (cardIndex: number, actionId: FloatingSongCardActionId | null) => {
      if (cardIndex < 0 || !actionId) return;
      const entry = displayItems[cardIndex];
      if (!entry) return;
      const busyKey = `${entry.song.queueId}:${actionId}`;
      if (actionBusyRef.current === busyKey) return;
      actionBusyRef.current = busyKey;
      pulseRef.current[cardIndex] = 1;
      try {
        if (actionId === 'favorite') {
          await toggleFavorite(entry.song);
        } else if (actionId === 'like' && !entry.song.isCurrent) {
          await toggleQueueLike(entry.song.queueId);
        } else if (actionId === 'jump' && !entry.song.isCurrent) {
          await requestJump(entry.song.queueId);
        } else if (actionId === 'remove' && !entry.song.isCurrent) {
          await removeSong(entry.song.queueId);
        } else if (actionId === 'ban' && !entry.song.isCurrent) {
          await banRoomSong(entry.song);
        }
      } finally {
        actionBusyRef.current = null;
        setActionRevision((v) => v + 1);
      }
    },
    [banRoomSong, displayItems, removeSong, requestJump, toggleFavorite, toggleQueueLike],
  );

  const isShelfWheelZone = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width);
    const ny = (clientY - rect.top) / Math.max(1, rect.height);
    const fx = roomVisualFxLive.current;
    if (fx.shelfMode === 'stage') return ny > 0.6;
    return nx > 0.72 && Math.abs(ny - 0.5) < 0.42;
  }, [gl]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerLeave = () => {
      hoveredCardRef.current = -1;
      hoveredActionRef.current = null;
      pointerDownRef.current = null;
      releaseGalaxyPointerInteraction();
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      const hit = getHitAtClientPoint(e.clientX, e.clientY);
      if (!hit) return;
      releaseGalaxyPointerInteraction();
      pointerDownRef.current = {
        x: e.clientX,
        y: e.clientY,
        cardIndex: hit.cardIndex,
        actionId: hit.actionId,
      };
      pulseRef.current[hit.cardIndex] = 1;
      e.stopPropagation();
    };

    const onPointerUpCapture = (e: PointerEvent) => {
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      releaseGalaxyPointerInteraction();
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > CLICK_THRESHOLD) return;
      const hit = getHitAtClientPoint(e.clientX, e.clientY);
      if (!hit || hit.cardIndex !== down.cardIndex) return;
      void runCardAction(hit.cardIndex, hit.actionId ?? down.actionId);
    };

    const onWheelCapture = (e: WheelEvent) => {
      if (roomVisualFxLive.current.shelfMode === 'off' || displayItems.length <= 1) return;
      const hit = getHitAtClientPoint(e.clientX, e.clientY);
      const inShelfArea = !!hit || isShelfWheelZone(e.clientX, e.clientY) || e.shiftKey;
      if (!inShelfArea) return;
      e.preventDefault();
      e.stopPropagation();
      const direction = e.deltaY > 0 ? 1 : -1;
      const prev = Math.round(centerTargetRef.current);
      centerTargetRef.current = Math.max(
        0,
        Math.min(displayItems.length - 1, centerTargetRef.current + direction),
      );
      const next = Math.round(centerTargetRef.current);
      if (next !== prev) pulseRef.current[next] = 0.55;
    };

    canvas.addEventListener('pointerleave', onPointerLeave, true);
    canvas.addEventListener('pointerdown', onPointerDownCapture, true);
    canvas.addEventListener('pointerup', onPointerUpCapture, true);
    canvas.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });
    return () => {
      canvas.removeEventListener('pointerleave', onPointerLeave, true);
      canvas.removeEventListener('pointerdown', onPointerDownCapture, true);
      canvas.removeEventListener('pointerup', onPointerUpCapture, true);
      canvas.removeEventListener('wheel', onWheelCapture, true);
    };
  }, [displayItems.length, getHitAtClientPoint, gl, isShelfWheelZone, runCardAction]);

  useFrame((state) => {
    const count = displayItems.length;
    for (let i = 0; i < count; i += 1) {
      pulseRef.current[i] = (pulseRef.current[i] || 0) * 0.9;
      if ((pulseRef.current[i] || 0) < 0.01) pulseRef.current[i] = 0;
    }

    if (!current || count === 0) {
      for (const card of cardsRef.current) card.mesh.visible = false;
      return;
    }

    centerSmoothRef.current += (centerTargetRef.current - centerSmoothRef.current) * 0.16;
    if (Math.abs(centerSmoothRef.current - centerTargetRef.current) < 0.001) {
      centerSmoothRef.current = centerTargetRef.current;
    }

    const fx = roomVisualFxLive.current;
    if (fx.shelfMode === 'off') {
      for (const card of cardsRef.current) card.mesh.visible = false;
      return;
    }

    const warmVisible = fx.shelfPresence === 'always' || presenceRef.current > 0.04;
    const bands = getCachedGalaxyAudioBands();
    const accent =
      fx.shelfAccentColor || (fx.visualTintMode === 'custom' ? fx.visualTintColor : fx.visualTintColor || '#00f5d4');
    const centerIndex = centerSmoothRef.current;
    const centerRounded = Math.round(centerIndex);

    raycasterRef.current.setFromCamera(pointer, camera);
    const visibleMeshes = cardsRef.current
      .map((card) => card.mesh)
      .filter((mesh) => mesh.visible);
    const intersections = warmVisible ? raycasterRef.current.intersectObjects(visibleMeshes, false) : [];
    const hoveredMesh = intersections[0]?.object as THREE.Mesh | undefined;
    const hoveredIndex = hoveredMesh ? Number(hoveredMesh.userData.cardIndex ?? -1) : -1;
    hoveredCardRef.current = hoveredIndex;

    if (hoveredIndex >= 0 && intersections[0]?.uv) {
      const uv = intersections[0].uv!;
      hoveredActionRef.current = hitTestFloatingSongCardAction(
        actionRegionsRef.current[hoveredIndex] || [],
        uv.x * 720,
        (1 - uv.y) * 360,
      );
    } else {
      hoveredActionRef.current = null;
    }

    const sidePresenceTarget =
      fx.shelfPresence === 'always'
        ? 1
        : pointer.x > 0.42 && Math.abs(pointer.y) < 0.78
          ? 1
          : hoveredIndex >= 0
            ? 1
            : 0;
    const stagePresenceTarget =
      fx.shelfPresence === 'always'
        ? 1
        : Math.abs(pointer.x) < 0.42 && pointer.y < 0.4
          ? 1
          : hoveredIndex >= 0
            ? 1
            : 0;
    const presenceTarget = fx.shelfMode === 'stage' ? stagePresenceTarget : sidePresenceTarget;
    presenceRef.current += (presenceTarget - presenceRef.current) * 0.08;

    const dynamicCamera = fx.shelfCameraMode === 'dynamic';
    const focusCard =
      hoveredIndex >= 0 &&
      dynamicCamera &&
      !hoveredActionRef.current &&
      pointerDownRef.current === null;
    if (focusCard) {
      const hoverZone = makeCardFocusZone(fx.shelfMode === 'stage' ? 'stage' : 'side', centerRounded);
      setGalaxyOrbitFocusZone(galaxyOrbitRef.current, 'cardHover', { ...hoverZone });
    } else if (galaxyOrbitRef.current.focusZone.type === 'cardHover') {
      setGalaxyOrbitFocusZone(galaxyOrbitRef.current, 'none');
    }

    gl.domElement.style.cursor = hoveredIndex >= 0 ? 'pointer' : '';
    const shelfMode = fx.shelfMode === 'stage' ? 'stage' : 'side';

    for (let i = 0; i < count; i += 1) {
      const entry = displayItems[i];
      const built = cardsRef.current[i];
      if (!built || !entry) continue;
      const mesh = built.mesh;
      mesh.userData.cardIndex = i;

      const isHovered = hoveredIndex === i;
      const isCenter = Math.abs(i - centerIndex) < 0.5;
      const targetHover = isHovered ? 1 : 0;
      hoverRef.current[i] = (hoverRef.current[i] || 0) + (targetHover - (hoverRef.current[i] || 0)) * 0.14;

      const pose = applyFloatingSongCardPose(mesh, state.clock.elapsedTime, hoverRef.current[i], {
        mode: shelfMode,
        cardIndex: i,
        centerSmooth: centerIndex,
        active: isCenter ? 1 : 0,
        pulse: pulseRef.current[i] || 0,
        scale: fx.shelfSize,
        offsetX: fx.shelfOffsetX,
        offsetY: fx.shelfOffsetY,
        offsetZ: fx.shelfOffsetZ,
        angleY: fx.shelfAngleY,
        breathWeight: Math.max(0.35, presenceRef.current),
      });

      if (!pose.visible) continue;

      mesh.renderOrder = 60 + Math.round((SHELF_VISIBLE_RADIUS + 1 - Math.min(pose.absD, SHELF_VISIBLE_RADIUS + 1)) * 10)
        + (isCenter ? 24 : 0)
        + (isHovered ? 12 : 0);

      const item: FloatingSongCardItem = {
        ...entry.item,
        bass: entry.song.isCurrent ? bands.bass : 0,
        isShelfCenter: isCenter,
      };

      const dofBlur = Math.max(0, Math.min(1, (pose.absD - 0.45) / 3.2));
      const drawKey = [
        entry.song.queueId,
        i,
        centerRounded,
        item.title,
        item.sub,
        item.coverUrl,
        item.tag,
        item.meta,
        Math.round(item.progress * 100),
        Math.round(item.bass * 20),
        accent,
        isHovered ? hoveredActionRef.current || '' : '',
        isCenter ? '1' : '0',
        Math.round(dofBlur * 10),
        item.actions.map((action) => `${action.id}:${action.active ? 1 : 0}:${action.badge || ''}`).join(','),
      ].join('|');

      const redraw = () => {
        actionRegionsRef.current[i] = drawFloatingSongCard(
          built.ctx,
          built.canvas,
          item,
          accent,
          state.clock.elapsedTime,
          fx.shelfBgOpacity,
          isHovered ? hoveredActionRef.current : null,
          redraw,
          dofBlur,
        );
        built.texture.needsUpdate = true;
      };

      if (drawKey !== drawKeyRef.current[i]) {
        drawKeyRef.current[i] = drawKey;
        redraw();
      } else if (isHovered || (pulseRef.current[i] || 0) > 0.01 || entry.song.isCurrent) {
        redraw();
      }

      const stackOpacity = pose.absD < 0.5 ? 1 : Math.max(0.22, 1 - pose.absD * 0.3);
      const passiveAlways = fx.shelfPresence === 'always';
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setScalar(1);
      const passiveDim = passiveAlways && !isCenter ? 0.92 : 1;
      mat.opacity = Math.min(
        1,
        (presenceRef.current + (pulseRef.current[i] || 0) * 0.1) * fx.shelfOpacity * stackOpacity * passiveDim,
      );
    }
  });

  return (
    <group>
      {Array.from({ length: cardCount }, (_, index) => (
        <primitive key={index} object={cardsRef.current[index]?.mesh} />
      ))}
    </group>
  );
}
