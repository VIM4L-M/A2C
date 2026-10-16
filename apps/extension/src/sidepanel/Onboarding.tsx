import { catalogEntry, type MemoryPermission } from '@a2c/shared';
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, FieldLabel, Notice, SelectInput, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { DEMO_PROFILE } from '../memory/facts';
import { checkPassphrase } from '../memory/vault';

const STARTER_KEYS = ['full_name', 'email', 'phone', 'college', 'degree', 'major', 'graduation_year', 'skills', 'github_url', 'portfolio_url', 'linkedin_url', 'current_role', 'work_experience', 'country'];

export function Onboarding() {
  const { checkFact, commitFact, updateSettings, createVault, vaultState } = useApp();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [perms, setPerms] = useState<Record<string, MemoryPermission>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const entered = STARTER_KEYS.filter((k) => values[k]?.trim());

  const validateValues = (): boolean => {
    const errs: Record<string, string> = {};
    for (const key of entered) {
      const c = checkFact({ key, value: values[key]!, source: 'onboarding' });
      if (!c.ok) errs[key] = c.error;
    }
    // Private facts (phone) live only in the encrypted vault.
    if (values.phone?.trim() && vaultState === 'none') {
      const weak = checkPassphrase(pass);
      if (weak) errs.phone = `Vault passphrase: ${weak}`;
      else if (pass !== pass2) errs.phone = 'Vault passphrases do not match';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const finish = async () => {
    setBusy(true);
    try {
      if (values.phone?.trim() && vaultState === 'none') await createVault(pass);
      for (const key of entered) {
        const c = checkFact({ key, value: values[key]!, permission: perms[key], source: 'onboarding' });
        if (c.ok) await commitFact(c.fact);
      }
      await updateSettings({ onboarded: true });
    } finally {
      setBusy(false);
    }
  };

  const steps = ['Welcome', 'Your details', 'Permissions', 'Privacy', 'Done'];

  return (
    <div className="flex min-h-full flex-col gap-3 p-3">
      <div className="flex gap-1" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((s, i) => (
          <div key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-line'}`} />
        ))}
      </div>

      {step === 0 ? (
        <Card>
          <div className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="size-4 text-accent" aria-hidden /> Welcome to A2C
          </div>
          <p className="mt-1 text-[13px] text-muted">Advanced Action Critic. Your memory. Any form. Automatically completed.</p>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-[12.5px] text-ink/85">
            <li>Save the details you are happy to reuse.</li>
            <li>Scan a form: Gemma 4 matches fields to your memory.</li>
            <li>Review, approve and fill. You always submit the form yourself.</li>
          </ul>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold">Add approved details</div>
            <Button size="sm" variant="ghost" onClick={() => setValues(Object.fromEntries(DEMO_PROFILE.filter((d) => STARTER_KEYS.includes(d.key)).map((d) => [d.key, d.value])))}>
              Use demo profile
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted">All optional. Leave anything blank: A2C will ask when a form needs it.</p>
          <div className="flex flex-col gap-2.5">
            {STARTER_KEYS.map((key) => (
              <div key={key}>
                <FieldLabel htmlFor={`ob-${key}`} hint={catalogEntry(key)?.list ? 'comma separated' : undefined}>
                  {catalogEntry(key)?.label}
                </FieldLabel>
                <TextInput id={`ob-${key}`} value={values[key] ?? ''} autoComplete="off" onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
                {key === 'phone' && values.phone?.trim() && vaultState === 'none' ? (
                  <div className="mt-1.5 flex flex-col gap-1.5 border-2 border-dashed border-line p-2">
                    <div className="text-[11px] text-muted">Phone is private: it is stored only in an encrypted vault. Choose a passphrase (10+ characters). It cannot be recovered.</div>
                    <TextInput type="password" autoComplete="new-password" placeholder="Vault passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
                    <TextInput type="password" autoComplete="new-password" placeholder="Confirm passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} />
                  </div>
                ) : null}
                {errors[key] ? <div className="mt-1 text-xs text-danger">{errors[key]}</div> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <div className="mb-2 font-semibold">Choose how each detail may be used</div>
          {entered.length === 0 ? <p className="text-xs text-muted">No details entered. You can add them later in My Memory.</p> : null}
          <div className="flex flex-col gap-2">
            {entered.map((key) => {
              const e = catalogEntry(key)!;
              return (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px]">{e.label}</span>
                  <SelectInput className="w-40" value={perms[key] ?? e.defaultPermission} onChange={(ev) => setPerms({ ...perms, [key]: ev.target.value as MemoryPermission })}>
                    <option value="auto">Automatic candidate</option>
                    <option value="ask">Approval required</option>
                    <option value="never">Never collect</option>
                  </SelectInput>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted">Sensitive fields such as email and phone always need your approval on each site, even if marked as automatic candidates.</p>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4 text-accent" aria-hidden /> How your privacy is protected
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] text-ink/85">
            <li>Memory stays in this browser. Private facts can go in an encrypted vault (Privacy tab).</li>
            <li>Gemma sees field labels and memory key names, never your values.</li>
            <li>Passwords, OTPs, card and bank details, and API keys are blocked and left to your browser.</li>
            <li>Nothing is learned from websites unless you click Save to memory.</li>
            <li>A2C never submits, pays, logs in or agrees to anything for you.</li>
          </ul>
        </Card>
      ) : null}

      {step === 4 ? (
        <Notice tone="ok" title="You are ready">
          {entered.length} detail{entered.length === 1 ? '' : 's'} will be saved. Open a form, click the A2C icon and press Scan Form.
        </Notice>
      ) : null}

      <div className="mt-auto flex gap-2">
        {step > 0 ? (
          <Button icon={ArrowLeft} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : null}
        {step < 4 ? (
          <Button
            className="flex-1"
            variant="primary"
            icon={ArrowRight}
            onClick={() => {
              if (step === 1 && !validateValues()) return;
              setStep(step + 1);
            }}
          >
            Continue
          </Button>
        ) : (
          <Button className="flex-1" variant="primary" icon={Check} loading={busy} onClick={finish}>
            Finish setup
          </Button>
        )}
      </div>
    </div>
  );
}
