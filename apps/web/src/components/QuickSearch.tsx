import type { FormEvent } from "react";
import { useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

const presetProfiles = [
  {
    label: "同城优先",
    values: { gender: "女性", minAge: "35", maxAge: "55", city: "上海", maritalStatus: "不限", goal: "认真交往" },
  },
  {
    label: "认真结婚",
    values: { gender: "女性", minAge: "38", maxAge: "60", city: "不限", maritalStatus: "离异", goal: "以结婚为目标" },
  },
  {
    label: "轻松认识",
    values: { gender: "男性", minAge: "35", maxAge: "60", city: "杭州", maritalStatus: "未婚", goal: "先认识了解" },
  },
] as const;

export function QuickSearch() {
  const navigate = useNavigate();
  const [formValues, setFormValues] = useState({
    gender: "女性",
    minAge: "40",
    maxAge: "55",
    city: "上海",
    maritalStatus: "不限",
    goal: "认真交往",
  });

  function updateField(key: keyof typeof formValues, value: string) {
    setFormValues((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(values: typeof formValues) {
    setFormValues(values);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(formValues)) {
      if (String(value) && String(value) !== "不限") params.set(key, String(value));
    }
    navigate(`/find?${params.toString()}`);
  }

  return (
    <div className="quick-search-wrap">
      <div className="quick-search-presets" aria-label="快捷筛选模板">
        {presetProfiles.map((profile) => (
          <button
            key={profile.label}
            type="button"
            className="button button--soft quick-search-preset"
            onClick={() => applyPreset(profile.values)}
          >
            {profile.label}
          </button>
        ))}
      </div>

      <form className="quick-search quick-search--premium" onSubmit={submit} aria-label="快速寻找对象">
        <label>
          <span>我想认识</span>
          <select name="gender" value={formValues.gender} onChange={(event) => updateField("gender", event.target.value)}>
            <option>女性</option>
            <option>男性</option>
          </select>
        </label>
        <fieldset>
          <legend>年龄范围</legend>
          <select name="minAge" value={formValues.minAge} onChange={(event) => updateField("minAge", event.target.value)} aria-label="最小年龄">
            {[35, 40, 45, 50, 55].map((age) => <option key={age}>{age}</option>)}
          </select>
          <span>至</span>
          <select name="maxAge" value={formValues.maxAge} onChange={(event) => updateField("maxAge", event.target.value)} aria-label="最大年龄">
            {[45, 50, 55, 60, 65].map((age) => <option key={age}>{age}</option>)}
          </select>
        </fieldset>
        <label>
          <span>所在城市</span>
          <select name="city" value={formValues.city} onChange={(event) => updateField("city", event.target.value)}>
            <option>不限</option>
            <option>上海</option>
            <option>杭州</option>
            <option>南京</option>
            <option>苏州</option>
          </select>
        </label>
        <label>
          <span>婚姻状态</span>
          <select name="maritalStatus" value={formValues.maritalStatus} onChange={(event) => updateField("maritalStatus", event.target.value)}>
            <option>不限</option>
            <option>未婚</option>
            <option>离异</option>
            <option>丧偶</option>
          </select>
        </label>
        <label>
          <span>交往目标</span>
          <select name="goal" value={formValues.goal} onChange={(event) => updateField("goal", event.target.value)}>
            <option>不限</option>
            <option>认真交往</option>
            <option>以结婚为目标</option>
            <option>先认识了解</option>
          </select>
        </label>
        <button className="button button--primary quick-search__submit" type="submit">
          <Search size={20} /> 开始寻找
        </button>
      </form>
    </div>
  );
}
