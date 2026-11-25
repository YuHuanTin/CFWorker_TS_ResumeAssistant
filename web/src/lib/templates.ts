/** 内置模板（构建时以原文打包进前端） */
import classic from '../templates/classic.typ?raw';
import modern from '../templates/modern.typ?raw';
import sidebar from '../templates/sidebar.typ?raw';
import blank from '../templates/blank.typ?raw';
import type { Template } from '../types';

export const TEMPLATES: Template[] = [
  { id: 'classic', title: '经典单栏', desc: 'ATS 友好，黑白稳重，最稳妥的通用版式', source: classic },
  { id: 'modern', title: '现代简约', desc: '主色强调、紧凑排版，适合互联网 / 技术岗', source: modern },
  { id: 'sidebar', title: '侧边栏双栏', desc: '左侧深色信息栏，适合设计与产品岗', source: sidebar },
  { id: 'blank', title: '空白起步', desc: '只保留必要的样式设置，从零开始写', source: blank },
];
