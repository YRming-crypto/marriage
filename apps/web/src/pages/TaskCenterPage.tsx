import { useCallback, useEffect, useState } from "react";
import { Calendar, CheckCircle, Clock, Flame, Gift, Star, Trophy } from "lucide-react";
import { doCheckIn, completeTask, getMyCheckIn } from "../api/client";
import { Link } from "react-router-dom";

type TaskInfo = { id: string; label: string; description: string; points: number; icon: string };
type Completion = { taskId: string; completed: boolean; completedAt: string | null; pointsAwarded: number };
type CheckInData = {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  totalPoints: number;
};

function StreakCalendar({ streak, longestStreak }: { streak: number; longestStreak: number }) {
  const today = new Date();
  const days: Array<{ date: string; active: boolean; today: boolean }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const isToday = i === 0;
    const daysAgo = i;
    const active = daysAgo < streak;
    days.push({ date: dateStr, active, today: isToday });
  }

  return (
    <div className="streak-calendar" aria-label="签到日历">
      <div className="streak-calendar__grid">
        {days.map((day) => (
          <div
            key={day.date}
            className={`streak-day${day.active ? " is-active" : ""}${day.today ? " is-today" : ""}`}
            title={day.date}
          >
            {day.active ? <CheckCircle aria-hidden="true" /> : <span>{new Date(day.date).getDate()}</span>}
          </div>
        ))}
      </div>
      <div className="streak-calendar__legend">
        <span><span className="streak-day is-active" style={{ width: "1rem", height: "1rem", display: "inline-flex" }} /><span>已签到</span></span>
        <span><span className="streak-day is-today" style={{ width: "1rem", height: "1rem", display: "inline-flex" }} /><span>今天</span></span>
      </div>
    </div>
  );
}

export function TaskCenterPage() {
  const [loading, setLoading] = useState(true);
  const [checkIn, setCheckIn] = useState<CheckInData | null>(null);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMyCheckIn();
      setCheckIn(result.data.checkIn);
      setHasCheckedInToday(result.data.hasCheckedInToday);
      setTasks(result.data.tasks);
      setCompletions(result.data.completions);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handleCheckIn() {
    if (checkInBusy) return;
    setCheckInBusy(true);
    setMessage(null);
    try {
      const result = await doCheckIn();
      setCheckIn(result.data.checkIn);
      setHasCheckedInToday(true);
      setMessage(`签到成功！${result.data.pointsEarned} 积分已到账，连续签到 ${result.data.streak} 天`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "签到失败");
    } finally {
      setCheckInBusy(false);
    }
  }

  async function handleCompleteTask(taskId: string) {
    if (taskBusy) return;
    setTaskBusy(taskId);
    setMessage(null);
    try {
      const result = await completeTask(taskId);
      setCheckIn(result.data.checkIn);
      setCompletions((prev) =>
        prev.map((c) => c.taskId === taskId ? { ...c, completed: true, completedAt: new Date().toISOString(), pointsAwarded: result.data.pointsAwarded } : c),
      );
      setMessage(`任务「${result.data.task.label}」完成！+${result.data.pointsAwarded} 积分`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "任务完成失败");
    } finally {
      setTaskBusy(null);
    }
  }

  const completionMap = new Map(completions.map((c) => [c.taskId, c]));

  if (loading) {
    return (
      <div className="page-shell shell">
        <div className="task-center-loading" role="status">
          <Clock aria-hidden="true" />
          <p>正在加载任务中心…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell shell">
      <header className="page-header">
        <span>任务中心</span>
        <h1>每天进步一点点</h1>
        <p>完成每日任务和签到，累积积分解锁更多特权。</p>
      </header>

      {message ? (
        <div className="task-message" role="status">{message}</div>
      ) : null}

      {/* Points overview */}
      <section className="points-overview" aria-label="积分总览">
        <div className="points-card">
          <Star aria-hidden="true" />
          <div>
            <strong>{checkIn?.totalPoints ?? 0}</strong>
            <span>我的积分</span>
          </div>
        </div>
        <div className="points-card points-card--streak">
          <Flame aria-hidden="true" />
          <div>
            <strong>{checkIn?.currentStreak ?? 0}</strong>
            <span>连续签到</span>
          </div>
        </div>
        <div className="points-card points-card--record">
          <Trophy aria-hidden="true" />
          <div>
            <strong>{checkIn?.longestStreak ?? 0}</strong>
            <span>最长连续</span>
          </div>
        </div>
      </section>

      {/* Daily Check-in */}
      <section className="checkin-section" aria-label="每日签到">
        <div className="checkin-header">
          <Calendar aria-hidden="true" />
          <strong>每日签到</strong>
          {hasCheckedInToday ? <span className="checkin-badge">今日已签到</span> : null}
        </div>
        <StreakCalendar streak={checkIn?.currentStreak ?? 0} longestStreak={checkIn?.longestStreak ?? 0} />
        <button
          className={`button ${hasCheckedInToday ? "button--secondary" : "button--primary"} button--block`}
          type="button"
          disabled={checkInBusy || hasCheckedInToday}
          onClick={() => void handleCheckIn()}
        >
          {hasCheckedInToday ? "✓ 已签到" : checkInBusy ? "签到中..." : "立即签到 (+10 积分)"}
        </button>
        {(checkIn?.currentStreak ?? 0) > 0 && (checkIn!.currentStreak) % 7 < 7 && (
          <p className="checkin-hint">
            再签 {7 - ((checkIn?.currentStreak ?? 0) % 7)} 天可获得连续 7 天奖励（+50 积分）
          </p>
        )}
      </section>

      {/* Daily Tasks */}
      <section className="task-section" aria-label="每日任务">
        <div className="task-section__header">
          <Gift aria-hidden="true" />
          <strong>每日任务</strong>
          <span>
            {completions.filter((c) => c.completed).length}/{tasks.length} 已完成
          </span>
        </div>
        <div className="task-list">
          {tasks.map((task) => {
            const completion = completionMap.get(task.id);
            const isCompleted = Boolean(completion?.completed);
            const isBusy = taskBusy === task.id;
            return (
              <div key={task.id} className={`task-card${isCompleted ? " is-completed" : ""}`}>
                <div className="task-card__icon">{task.icon}</div>
                <div className="task-card__info">
                  <strong>{task.label}</strong>
                  <p>{task.description}</p>
                  <span className="task-card__points">+{task.points} 积分</span>
                </div>
                <div className="task-card__action">
                  {isCompleted ? (
                    <span className="task-done">
                      <CheckCircle aria-hidden="true" />已完成
                    </span>
                  ) : (
                    <button
                      className="button button--primary button--small"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleCompleteTask(task.id)}
                    >
                      {isBusy ? "检查中..." : "去领取"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Points guide */}
      <section className="points-guide" aria-label="积分用途">
        <h2>积分能做什么？</h2>
        <div className="points-guide__grid">
          <div className="points-guide__item">
            <Star aria-hidden="true" />
            <div>
              <strong>兑换 VIP 天数</strong>
              <p>100 积分 = 1 天 VIP 会员</p>
            </div>
          </div>
          <div className="points-guide__item">
            <Flame aria-hidden="true" />
            <div>
              <strong>解锁超级喜欢</strong>
              <p>50 积分 = 1 次超级喜欢</p>
            </div>
          </div>
          <div className="points-guide__item">
            <Gift aria-hidden="true" />
            <div>
              <strong>购买虚拟礼物</strong>
              <p>20 积分起，送给心仪的人</p>
            </div>
          </div>
        </div>
        <Link className="button button--secondary button--block" to="/vip">了解 VIP 特权</Link>
      </section>
    </div>
  );
}
