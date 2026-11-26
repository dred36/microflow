/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Material, PatternType, MaterialCategory } from '../types/microfab';
import { isCrystallineKohMaterial } from '../lib/materials';
import { Plus, Trash2, X, Search } from 'lucide-react';

interface MaterialsModalProps {
  materials: Material[];
  onUpdateMaterials: (updated: Material[]) => void;
  onClose: () => void;
}

export const MaterialsModal: React.FC<MaterialsModalProps> = ({
  materials,
  onUpdateMaterials,
  onClose,
}) => {
  const [editingMat, setEditingMat] = useState<Material | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Form state for creating/editing material
  const [name, setName] = useState<string>('');
  const [formula, setFormula] = useState<string>('');
  const [color, setColor] = useState<string>('#3b82f6');
  const [pattern, setPattern] = useState<PatternType>('diagonal-right');
  const [category, setCategory] = useState<MaterialCategory>('dielectric');
  const [density, setDensity] = useState<string>('2.5');
  const [refractiveIndex, setRefractiveIndex] = useState<string>('1.5');
  const [notes, setNotes] = useState<string>('');
  const [crystallineAnisotropic, setCrystallineAnisotropic] = useState<boolean>(false);

  const handleStartAdd = () => {
    setEditingMat({
      id: `mat_custom_${Date.now()}`,
      name: 'Custom Thin Film',
      formula: 'X',
      color: '#06b6d4',
      pattern: 'crosshatch',
      category: 'custom',
      isCustom: true,
      crystallineAnisotropic: false,
    });
    setName('Custom Thin Film');
    setFormula('X');
    setColor('#06b6d4');
    setPattern('crosshatch');
    setCategory('custom');
    setDensity('2.5');
    setRefractiveIndex('1.5');
    setNotes('');
    setCrystallineAnisotropic(false);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const newOrUpdated: Material = {
      id: editingMat?.id || `mat_custom_${Date.now()}`,
      name: name.trim(),
      formula: formula.trim() || name.substring(0, 4),
      color,
      pattern,
      category,
      density: parseFloat(density) || undefined,
      refractiveIndex: parseFloat(refractiveIndex) || undefined,
      notes: notes.trim() || undefined,
      isCustom: true,
      crystallineAnisotropic,
    };

    const exists = materials.some((m) => m.id === newOrUpdated.id);
    let updated: Material[];
    if (exists) {
      updated = materials.map((m) => (m.id === newOrUpdated.id ? newOrUpdated : m));
    } else {
      updated = [...materials, newOrUpdated];
    }

    onUpdateMaterials(updated);
    setEditingMat(null);
  };

  const handleDelete = (id: string) => {
    const updated = materials.filter((m) => m.id !== id);
    onUpdateMaterials(updated);
    if (editingMat?.id === id) setEditingMat(null);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = materials.filter((m) => {
    if (filterCategory !== 'all' && m.category !== filterCategory) {
      return false;
    }
    if (!normalizedQuery) return true;
    const haystack = [
      m.name,
      m.formula,
      m.category,
      m.pattern,
      m.notes || '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-2 sm:p-4">
      <div className="relative w-full max-w-4xl max-h-[94dvh] sm:max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-800 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-white truncate">
              Semiconductor Materials & Thin Films Library
            </h2>
            <p className="hidden sm:block text-xs text-slate-400">
              Configure physical layers, optical properties, and cleanroom hatch patterns
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={handleStartAdd}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Custom Material</span>
              <span className="sm:hidden">Custom</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          {/* Left: Material List & Filter */}
          <div className="w-full md:w-3/5 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col max-h-[42dvh] md:max-h-none shrink-0 md:shrink">
            {/* Search input */}
            <div className="px-2.5 pt-2.5 pb-1.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && searchQuery) {
                      e.stopPropagation();
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Search by name, formula, or notes..."
                  aria-label="Search semiconductor materials"
                  className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-white"
                    aria-label="Clear material search"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <span className="text-[11px] font-mono text-slate-400 shrink-0">
                {filtered.length}/{materials.length}
              </span>
            </div>

            {/* Category filter tabs */}
            <div className="flex items-center gap-1 p-2 bg-slate-950/60 border-b border-slate-800 text-xs overflow-x-auto">
              {['all', 'substrate', 'dielectric', 'metal', 'semiconductor', 'photoresist', 'polymer', 'custom'].map(
                (cat) => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`px-2.5 py-1 rounded-md capitalize font-medium whitespace-nowrap transition-colors ${
                      filterCategory === cat
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                )
              )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {filtered.length === 0 ? (
                <div className="py-8 px-4 text-center text-xs text-slate-400 space-y-2">
                  <p>
                    No materials match
                    {searchQuery ? ` "${searchQuery.trim()}"` : ''}
                    {filterCategory !== 'all' ? ` in ${filterCategory}` : ''}.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setFilterCategory('all');
                    }}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 text-[11px] font-medium transition-colors"
                  >
                    Reset search &amp; category
                  </button>
                </div>
              ) : (
                filtered.map((mat) => {
                  const isSelected = editingMat?.id === mat.id;
                  return (
                    <div
                      key={mat.id}
                      onClick={() => {
                        setEditingMat(mat);
                        setName(mat.name);
                        setFormula(mat.formula);
                        setColor(mat.color);
                        setPattern(mat.pattern);
                        setCategory(mat.category);
                        setDensity(mat.density?.toString() || '');
                        setRefractiveIndex(mat.refractiveIndex?.toString() || '');
                        setNotes(mat.notes || '');
                        setCrystallineAnisotropic(isCrystallineKohMaterial(mat));
                      }}
                      className={`flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer border transition-colors ${
                        isSelected
                          ? 'bg-sky-950/60 border-sky-500 text-white shadow-md'
                          : 'bg-slate-950/40 border-slate-800 hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-4 h-4 rounded-md border border-white/20 flex-shrink-0"
                          style={{ backgroundColor: mat.color }}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{mat.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {mat.formula} · <span className="capitalize">{mat.category}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                        <span className="capitalize">{mat.pattern}</span>
                        {mat.isCustom && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(mat.id);
                            }}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Delete custom material"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Material Inspector & Editor Form */}
          <div className="w-full md:w-2/5 p-3 sm:p-4 md:overflow-y-auto bg-slate-950/40">
            {editingMat ? (
              <div className="space-y-3 text-xs">
                <span className="text-xs font-bold text-sky-400 uppercase tracking-wide block">
                  {editingMat.isCustom ? 'Custom Material Config' : 'View Material Specs'}
                </span>

                <div>
                  <label className="block text-slate-400 mb-1">Material Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!editingMat.isCustom}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-medium focus:outline-none focus:border-sky-500 disabled:opacity-60"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Formula</label>
                    <input
                      type="text"
                      value={formula}
                      onChange={(e) => setFormula(e.target.value)}
                      disabled={!editingMat.isCustom}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Color (Hex)</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        disabled={!editingMat.isCustom}
                        className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent disabled:opacity-60"
                      />
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        disabled={!editingMat.isCustom}
                        className="w-full px-1.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-sky-500 disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Hatch Pattern</label>
                    <select
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value as PatternType)}
                      disabled={!editingMat.isCustom}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                    >
                      <option value="solid">Solid</option>
                      <option value="diagonal-right">Diagonal 45°</option>
                      <option value="diagonal-left">Diagonal -45°</option>
                      <option value="crosshatch">Crosshatch</option>
                      <option value="dots">Dots</option>
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                      <option value="stipple">Stipple</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as MaterialCategory)}
                      disabled={!editingMat.isCustom}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                    >
                      <option value="dielectric">Dielectric</option>
                      <option value="metal">Metal</option>
                      <option value="semiconductor">Semiconductor</option>
                      <option value="photoresist">Photoresist</option>
                      <option value="polymer">Polymer</option>
                      <option value="substrate">Substrate</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Density (g/cm³)</label>
                    <input
                      type="text"
                      value={density}
                      onChange={(e) => setDensity(e.target.value)}
                      disabled={!editingMat.isCustom}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Refractive Index</label>
                    <input
                      type="text"
                      value={refractiveIndex}
                      onChange={(e) => setRefractiveIndex(e.target.value)}
                      disabled={!editingMat.isCustom}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Cleanroom Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={!editingMat.isCustom}
                    rows={2}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                  />
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">KOH / TMAH Wet Etch</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                        crystallineAnisotropic
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      {crystallineAnisotropic ? 'Crystal {111} Planes' : 'Isotropic (Non-Crystal)'}
                    </span>
                  </div>
                  {editingMat.isCustom && (
                    <label className="flex items-center gap-2 pt-1 cursor-pointer text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={crystallineAnisotropic}
                        onChange={(e) => setCrystallineAnisotropic(e.target.checked)}
                        className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
                      />
                      <span>Single-crystal (etches along crystal planes in KOH / TMAH)</span>
                    </label>
                  )}
                </div>

                {editingMat.isCustom && (
                  <button
                    onClick={handleSave}
                    className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors mt-2"
                  >
                    Save Custom Material
                  </button>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-center p-4 text-slate-500 text-xs">
                Select a material from the list or click "Add Custom Material" to configure a new thin film.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
