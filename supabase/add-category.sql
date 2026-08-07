alter table public.expenses
  add column if not exists category text not null default '기타';

update public.expenses
set category = '기타'
where category is null or category = '';
