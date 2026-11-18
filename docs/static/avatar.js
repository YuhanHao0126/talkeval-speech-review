import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { clone } from './vendor/utils/SkeletonUtils.js';

const positionOf = object => object.getWorldPosition(new THREE.Vector3());
const quaternionOf = object => object.getWorldQuaternion(new THREE.Quaternion());
const clamp = THREE.MathUtils.clamp;
const posePoint = (positions, index) => new THREE.Vector3().fromArray(positions[index]);

function setWorldRotation(bone, rotation) {
  bone.quaternion.copy(quaternionOf(bone.parent).invert().multiply(rotation));
  bone.updateWorldMatrix(false, false);
}

function limitedDirection(direction, fallback) {
  return direction.lengthSq() > 0.0001 && Number.isFinite(direction.lengthSq()) ? direction.normalize() : fallback.clone().normalize();
}

function palmBasis(wrist,index,pinky) {
  const y=index.clone().add(pinky).multiplyScalar(.5).sub(wrist).normalize();
  const x=index.clone().sub(pinky).normalize();
  const z=x.clone().cross(y).normalize();
  if(z.lengthSq()<.5)return null;
  x.copy(y).cross(z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}

export class SpeakerAvatar {
  constructor(source) {
    this.group = new THREE.Group();
    this.model = clone(source);
    this.group.add(this.model);
    this.bones = new Map();
    this.model.traverse(object => {
      if (object.isBone) this.bones.set(object.name, object);
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
        object.frustumCulled = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const refinedMaterials = materials.map(material => {
          const skin = material.name.includes('head');
          const hair = material.name.includes('opacity');
          const refined = new THREE.MeshStandardMaterial({
            name: material.name, map: material.map, normalMap: material.normalMap,
            normalScale: new THREE.Vector2(skin ? 0.62 : 0.4, skin ? 0.62 : 0.4),
            roughness: skin ? 0.59 : hair ? 0.83 : 0.9,
            metalness: 0,
            side: material.side, alphaTest: hair ? 0.3 : 0,
            alphaToCoverage: hair,
          });
          if (refined.map) refined.map.anisotropy = 8;
          return refined;
        });
        object.material = Array.isArray(object.material) ? refinedMaterials : refinedMaterials[0];
      }
    });
    this.model.updateMatrixWorld(true);
    const left = this.bone('L_UpperArm');
    const right = this.bone('R_UpperArm');
    this.model.scale.setScalar(1 / positionOf(left).distanceTo(positionOf(right)));
    this.model.updateMatrixWorld(true);
    this.center = positionOf(left).add(positionOf(right)).multiplyScalar(0.5);
    this.model.position.sub(this.center);
    this.model.updateMatrixWorld(true);
    this.rest = new Map();
    this.bones.forEach((bone, name) => this.rest.set(name, {
      local: bone.quaternion.clone(), world: quaternionOf(bone), position: positionOf(bone),
    }));
    this.arms = ['L', 'R'].map(side => {
      const upper = this.bone(`${side}_UpperArm`);
      const lower = this.bone(`${side}_Forearm`);
      const hand = this.bone(`${side}_Hand`);
      return {
        side, upper, lower, hand,
        upperLength: positionOf(upper).distanceTo(positionOf(lower)),
        lowerLength: positionOf(lower).distanceTo(positionOf(hand)),
        upperDirection: positionOf(lower).sub(positionOf(upper)).normalize(),
        lowerDirection: positionOf(hand).sub(positionOf(lower)).normalize(),
        palmBasis:palmBasis(positionOf(hand),positionOf(this.bone(`${side}_Finger1`)),positionOf(this.bone(`${side}_Finger4`))),
      };
    });
    this.lastQuality = { inferred: 0, neutral: 2 };
    this.driven = ['Spine2', 'Head', ...['L','R'].flatMap(side=>['UpperArm','Forearm','Hand'].map(part=>`${side}_${part}`))].map(name=>this.bone(name));
  }

  bone(name) {
    const bone = this.bones.get(`Bip01_${name}`);
    if (!bone) throw new Error(`人物模型缺少关节 ${name}`);
    return bone;
  }

  dispose() {
    this.group.removeFromParent();
    this.model.traverse(object => {
      if (object.isMesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
        if (object.userData.ghostGeometry) object.geometry.dispose();
      }
    });
  }

  setGhost(color, opacity) {
    this.model.traverse(object => {
      if (!object.isMesh) return;
      if (!object.isSkinnedMesh) { object.visible = false; return; }
      // Only arm vertices become translucent trails; avoid tinting the face/torso.
      object.geometry = object.geometry.clone(); object.userData.ghostGeometry = true;
      const indices = object.geometry.getAttribute('skinIndex');
      const weights = object.geometry.getAttribute('skinWeight');
      const getters = ['getX','getY','getZ','getW'];
      const mask = new Float32Array(indices.count);
      for (let vertex=0; vertex<indices.count; vertex++) {
        for (let c=0;c<4;c++) {
          const bone = object.skeleton.bones[indices[getters[c]](vertex)];
          if (bone && /Bip01_[LR]_(UpperArm|Forearm|Hand|Finger)/.test(bone.name)) mask[vertex] += weights[getters[c]](vertex);
        }
      }
      object.geometry.setAttribute('ghostArmMask',new THREE.BufferAttribute(mask,1));
      // Do not send face/torso triangles through the transparent rendering pass.
      const original = object.geometry.index;
      const retained = [];
      for (let i=0; i<(original?.count ?? indices.count); i+=3) {
        const triangle=[0,1,2].map(k=>original ? original.getX(i+k) : i+k);
        if (triangle.some(v=>mask[v]>.03)) retained.push(...triangle);
      }
      object.geometry.setIndex(retained);
      if (!retained.length) { object.visible=false; return; }
      object.castShadow = false;
      object.receiveShadow = false;
      object.renderOrder = 2;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        material.map = null; material.normalMap = null; material.color.set(color);
        material.transparent = true; material.opacity = opacity; material.depthWrite = false;
        material.roughness = .8; material.alphaTest = 0; material.needsUpdate = true;
        material.onBeforeCompile = shader => {
          shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float ghostArmMask;\nvarying float vGhostArmMask;').replace('#include <begin_vertex>','#include <begin_vertex>\nvGhostArmMask = ghostArmMask;');
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vGhostArmMask;').replace('#include <alphatest_fragment>','diffuseColor.a *= vGhostArmMask;\nif (diffuseColor.a < 0.015) discard;\n#include <alphatest_fragment>');
        };
        material.customProgramCacheKey=()=> 'talkeval-arm-trails-v1';
      }
    });
  }

  aim(bone, restDirection, direction) {
    const rotation = new THREE.Quaternion().setFromUnitVectors(restDirection, direction);
    rotation.multiply(this.rest.get(bone.name).world);
    setWorldRotation(bone, rotation);
  }

  tintGhost(color) {
    if(this.ghostColor===color)return;this.ghostColor=color;
    this.model.traverse(o=>{if(o.isMesh)for(const m of(Array.isArray(o.material)?o.material:[o.material]))m.color.set(color);});
  }

  update(positions, visibility, detail=null) {
    this.group.visible = Boolean(positions);
    if (!positions) return;
    this.driven.forEach(bone => bone.quaternion.copy(this.rest.get(bone.name).local));
    this.group.updateWorldMatrix(true, false);
    const shoulderAxis = posePoint(positions, 1).sub(posePoint(positions, 2)).normalize();
    const shouldersValid = Math.min(visibility?.[1] ?? 0, visibility?.[2] ?? 0) >= 0.4;
    const yaw = shouldersValid ? clamp(-Math.atan2(shoulderAxis.z, Math.abs(shoulderAxis.x)), -0.55, 0.55) : 0;
    const roll = shouldersValid ? clamp(Math.atan2(shoulderAxis.y, Math.abs(shoulderAxis.x)), -0.2, 0.2) : 0;
    const chest = this.bone('Spine2');
    const hipsValid=Math.min(visibility?.[7]||0,visibility?.[8]||0)>=.5;
    const hipCenter=posePoint(positions,7).add(posePoint(positions,8)).multiplyScalar(.5);
    const pitch=hipsValid?clamp(Math.atan2(hipCenter.z,-hipCenter.y),-.3,.3):0;
    const chestRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    setWorldRotation(chest, chestRotation.multiply(this.rest.get(chest.name).world));
    const quality = { inferred: 0, neutral: 0, palms:0 };
    for (const arm of this.arms) {
      const side = arm.side === 'L' ? 1 : -1;
      const [shoulderIndex, elbowIndex, wristIndex] = side === 1 ? [1, 3, 5] : [2, 4, 6];
      const elbowVisible = Math.min(visibility?.[shoulderIndex] ?? 0, visibility?.[elbowIndex] ?? 0) >= 0.4;
      const wristVisible = Math.min(visibility?.[shoulderIndex] ?? 0, visibility?.[wristIndex] ?? 0) >= 0.4;
      let upperDirection = new THREE.Vector3(side * 0.12, -1, 0.04).normalize();
      let lowerDirection = new THREE.Vector3(-side * 0.12, -0.96, 0.19).normalize();
      if (elbowVisible) {
        upperDirection = limitedDirection(posePoint(positions, elbowIndex).sub(posePoint(positions, shoulderIndex)), upperDirection);
        if (wristVisible) lowerDirection = limitedDirection(posePoint(positions, wristIndex).sub(posePoint(positions, elbowIndex)), lowerDirection);
        else quality.inferred += 1;
      } else if (wristVisible) {
        const target = posePoint(positions, wristIndex).sub(posePoint(positions, shoulderIndex));
        const reach = clamp(target.length(), 0.2, (arm.upperLength + arm.lowerLength) * 0.97);
        const direction = limitedDirection(target, new THREE.Vector3(side * 0.2, -1, 0.4));
        const bend = new THREE.Vector3(side * 0.8, -0.9, 0.15);
        bend.addScaledVector(direction, -bend.dot(direction)).normalize();
        const along = (arm.upperLength ** 2 - arm.lowerLength ** 2 + reach ** 2) / (2 * reach);
        const height = Math.sqrt(Math.max(0, arm.upperLength ** 2 - along ** 2));
        const elbow = direction.clone().multiplyScalar(along).addScaledVector(bend, height);
        upperDirection = elbow.clone().normalize();
        lowerDirection = direction.multiplyScalar(reach).sub(elbow).normalize();
        quality.inferred += 1;
      } else quality.neutral += 1;
      this.aim(arm.upper, arm.upperDirection, upperDirection);
      this.aim(arm.lower, arm.lowerDirection, lowerDirection);
      if(detail && wristVisible && arm.palmBasis) {
        const [wrist,index,pinky]=side===1?[15,19,17]:[16,20,18];
        if([wrist,index,pinky].every(j=>(detail.visibility?.[j]||0)>=.55)) {
          const basis=palmBasis(...[wrist,index,pinky].map(j=>posePoint(detail.positions,j)));
          if(basis){setWorldRotation(arm.hand,basis.multiply(arm.palmBasis.clone().invert()).multiply(this.rest.get(arm.hand.name).world));quality.palms++;}
        }
      }
    }
    if ((visibility?.[0] ?? 0) >= 0.4) {
      const nose = posePoint(positions, 0);
      const head = this.bone('Head');
      const earsValid=detail && [7,8].every(j=>(detail.visibility?.[j]||0)>=.55);
      const earAxis=earsValid?posePoint(detail.positions,7).sub(posePoint(detail.positions,8)):null;
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        clamp((0.52 - nose.y) * 0.35, -0.15, 0.15),
        earsValid?clamp(-Math.atan2(earAxis.z,Math.abs(earAxis.x)),-.65,.65):clamp(nose.x * 0.8 + yaw * 0.35, -0.4, 0.4),
        roll * 0.4,
        'YXZ',
      ));
      setWorldRotation(head, rotation.multiply(this.rest.get(head.name).world));
    }
    this.group.updateMatrixWorld(true);
    this.lastQuality = quality;
  }
}

const avatarSources = new Map();

export async function loadSpeakerAvatars(scene, quality = 'hd', character = 'female', options = {}) {
  const filename = character === 'male' ? 'speaker-male' : 'speaker';
  const path = `/talkeval-speech-review/static/avatar/${filename}${quality === 'hd' ? '-hd' : ''}.glb`;
  if (!avatarSources.has(path)) avatarSources.set(path, new GLTFLoader().loadAsync(path).catch(error => { avatarSources.delete(path); throw error; }));
  const loaded = await avatarSources.get(path);
  const predicted = options.predicted===false ? null : new SpeakerAvatar(loaded.scene);
  const actual = new SpeakerAvatar(loaded.scene);
  const ghosts = [0x91b8d5, 0x32afa9, 0x137d82].map((color,index) => {
    const ghost = new SpeakerAvatar(loaded.scene); ghost.setGhost(color,[.12,.20,.34][index]);
    ghost.group.visible = false; scene.add(ghost.group); return ghost;
  });
  scene.add(actual.group);
  if(predicted){scene.add(predicted.group);predicted.group.visible = false;}
  actual.group.visible = false;
  return { predicted, actual, ghosts };
}
