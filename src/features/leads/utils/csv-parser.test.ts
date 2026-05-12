import { describe, expect, it } from 'vitest';

import { parseCsv } from './csv-parser';

describe('csv-parser', () => {
  describe('parseCsv', () => {
    it('should parse a simple CSV with CNPJ header', () => {
      const csv = 'cnpj\n11222333000181\n45678901000175';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.totalRows).toBe(2);
      expect(result.rows[0]?.cnpj).toBe('11222333000181');
      expect(result.rows[1]?.cnpj).toBe('45678901000175');
    });

    it('should detect CNPJ column with different header names', () => {
      const csv = 'nome,documento\nTest,11222333000181';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.cnpj).toBe('11222333000181');
    });

    it('should extract razao_social and nome_fantasia', () => {
      const csv = 'cnpj,razao_social,nome_fantasia\n11222333000181,Empresa Ltda,EmpLtda';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.razao_social).toBe('Empresa Ltda');
      expect(result.rows[0]?.nome_fantasia).toBe('EmpLtda');
    });

    it('should handle formatted CNPJs', () => {
      const csv = 'cnpj\n11.222.333/0001-81';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.cnpj).toBe('11222333000181');
    });

    it('should report invalid CNPJs as errors', () => {
      const csv = 'cnpj\n11222333000181\n00000000000000\n11222333000199';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]?.errorMessage).toBe('CNPJ inválido');
      expect(result.errors[0]?.rowNumber).toBe(3);
    });

    it('should accept rows with empty CNPJ when another identifier is present', () => {
      // After CNPJ became optional, an empty CNPJ no longer rejects the row —
      // dedup falls back to email or razao_social+telefone. The row only fails
      // when nothing identifies it.
      const csv = 'cnpj,razao_social\n11222333000181,ok\n,Empresa Sem CNPJ';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.rows[0]?.cnpj).toBe('11222333000181');
      expect(result.rows[1]?.cnpj).toBeNull();
      expect(result.rows[1]?.razao_social).toBe('Empresa Sem CNPJ');
    });

    it('should reject rows with no identifying field at all', () => {
      const csv = 'cnpj,razao_social,email,telefone\n11222333000181,ok,,\n,,,';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.errorMessage).toContain('sem identificação');
    });

    it('should return error for empty file', () => {
      const result = parseCsv('');
      expect(result.rows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.errorMessage).toContain('vazio');
    });

    it('should return error for header-only file', () => {
      const result = parseCsv('cnpj');
      expect(result.rows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    });

    it('should accept files without CNPJ column when email is present', () => {
      // 'nome' is not one of the recognized identifying columns, so razao_social
      // mapping needs an explicit header; here we rely on email instead.
      const csv = 'razao_social,email\nTest,test@test.com';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.cnpj).toBeNull();
      expect(result.rows[0]?.email).toBe('test@test.com');
      expect(result.rows[0]?.razao_social).toBe('Test');
    });

    it('should return error when no identifying column exists', () => {
      const csv = 'nome,observacao\nTest,nota qualquer';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.errorMessage).toContain('Nenhuma coluna identificável');
    });

    it('should reject files with more than 1000 rows', () => {
      const rows = ['cnpj'];
      for (let i = 0; i < 1001; i++) {
        rows.push('11222333000181');
      }
      const result = parseCsv(rows.join('\n'));

      expect(result.rows).toHaveLength(0);
      expect(result.errors[0]?.errorMessage).toContain('1000');
    });

    it('should handle semicolon-separated CSV', () => {
      const csv = 'cnpj;razao_social\n11222333000181;Empresa Ltda';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.razao_social).toBe('Empresa Ltda');
    });

    it('should handle quoted fields', () => {
      const csv = 'cnpj,razao_social\n11222333000181,"Empresa, Ltda"';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.razao_social).toBe('Empresa, Ltda');
    });

    it('should auto-detect CNPJ column by content', () => {
      const csv = 'id,number,name\n1,11222333000181,Test';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.cnpj).toBe('11222333000181');
    });

    it('should set correct row numbers', () => {
      const csv = 'cnpj\n11222333000181\n45678901000175';
      const result = parseCsv(csv);

      expect(result.rows[0]?.rowNumber).toBe(2);
      expect(result.rows[1]?.rowNumber).toBe(3);
    });

    it('should handle Windows line endings', () => {
      const csv = 'cnpj\r\n11222333000181\r\n45678901000175';
      const result = parseCsv(csv);

      expect(result.rows).toHaveLength(2);
    });

    it('should extract telefone column and build phones array (celular)', () => {
      const csv = 'cnpj,telefone\n11222333000181,(11) 99876-5432';
      const result = parseCsv(csv);

      expect(result.rows[0]?.telefone).toBe('(11) 99876-5432');
      expect(result.rows[0]?.phones).toEqual([{ tipo: 'celular', numero: '(11) 99876-5432' }]);
    });

    it('should classify landline phones as fixo', () => {
      const csv = 'cnpj,telefone\n11222333000181,(11) 3456-7890';
      const result = parseCsv(csv);

      expect(result.rows[0]?.phones?.[0]?.tipo).toBe('fixo');
    });

    it('should extract email column and classify domain', () => {
      const csv = 'cnpj,email\n11222333000181,contato@empresa.com.br';
      const result = parseCsv(csv);

      expect(result.rows[0]?.email).toBe('contato@empresa.com.br');
      expect(result.rows[0]?.emails).toEqual([{ tipo: 'corporativo', email: 'contato@empresa.com.br' }]);
    });

    it('should classify gmail/hotmail as pessoal', () => {
      const csv = 'cnpj,email\n11222333000181,joao@gmail.com';
      const result = parseCsv(csv);

      expect(result.rows[0]?.emails?.[0]?.tipo).toBe('pessoal');
    });

    it('should extract decisor and job_title', () => {
      const csv = 'cnpj,decisor,cargo\n11222333000181,João Silva,CEO';
      const result = parseCsv(csv);

      expect(result.rows[0]?.decisor).toBe('João Silva');
      expect(result.rows[0]?.job_title).toBe('CEO');
    });

    it('should extract website/instagram/linkedin', () => {
      const csv = 'cnpj,website,instagram,linkedin\n11222333000181,https://x.com,@xco,linkedin.com/x';
      const result = parseCsv(csv);

      expect(result.rows[0]?.website).toBe('https://x.com');
      expect(result.rows[0]?.instagram).toBe('@xco');
      expect(result.rows[0]?.linkedin).toBe('linkedin.com/x');
    });

    it('should accept Brazilian header variants (telefone, e-mail, contato)', () => {
      const csv = 'cnpj,e-mail,celular,contato\n11222333000181,a@b.com,(11) 99999-9999,Maria';
      const result = parseCsv(csv);

      expect(result.rows[0]?.email).toBe('a@b.com');
      expect(result.rows[0]?.telefone).toBe('(11) 99999-9999');
      expect(result.rows[0]?.decisor).toBe('Maria');
    });
  });
});
