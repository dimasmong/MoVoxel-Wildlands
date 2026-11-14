import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
new Game(canvas);
