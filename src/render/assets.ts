/// <reference types="vite/client" />
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import city from '../assets/city.glb?url';
import nature from '../assets/nature.glb?url';
import cars from '../assets/cars.glb?url';

const urls = { city, nature, cars };
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export function loadAssets(bundle: keyof typeof urls) {
  return loader.loadAsync(urls[bundle]);
}
