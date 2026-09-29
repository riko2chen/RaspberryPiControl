import {useEffect, useState} from 'react';
import {FlaskConical, RotateCcw} from 'lucide-react';
import {api} from '../api';

const temperatures = [[38, '待机'], [53, '日常'], [68, '高负载'], [78, '高温保护']] as const;

export function DemoBanner() {
  const [temperature, setTemperature] = useState(53);
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    api('/demo').then(d => {
      setTemperature(d.temperature);
      setWarning(d.storageWarning);
    });
  }, []);

  async function changeTemperature(value: number) {
    await api('/demo', {method: 'PUT', body: JSON.stringify({temperature: value})});
    setTemperature(value);
  }

  return <section className="demo-banner" aria-label="演示模式">
    <div>
      <FlaskConical size={20}/>
      <div>
        <strong>交互演示 · 无需树莓派</strong>
        <p>试试灯光、风扇、OLED 和 3D 展开。所有操作只保存在当前浏览器。</p>
        {warning && <p>浏览器存储不可用，关闭页面后可能丢失本次修改。</p>}
      </div>
    </div>
    <div className="demo-actions">
      <div>
        <span className="demo-temperature-label">模拟 CPU 温度</span>
        <div className="demo-temperature" role="group" aria-label="模拟 CPU 温度">
          {temperatures.map(([value, name]) => <button
            key={value}
            aria-pressed={temperature === value}
            onClick={() => void changeTemperature(value)}
          >{value}°C <span>{name}</span></button>)}
        </div>
      </div>
      <button className="btn small" onClick={async () => {
        await api('/demo/reset', {method: 'POST'});
        location.reload();
      }}><RotateCcw size={14}/>重置演示</button>
    </div>
  </section>;
}
